/*
  Uploads the colourway photography to Supabase Storage and records the public
  URL of each file, keyed by product slug and colour name.

  Storage rather than /public so photos can be replaced from the admin without
  a redeploy. Paths are deterministic (<slug>/<colour>.jpg) and uploads use
  upsert, so re-running replaces rather than duplicates.

  Writes scripts/out/image-urls.json for the step that fills product_images.
*/
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/* No dotenv in this project — read .env.local directly. */
for (const line of (await readFile(".env.local", "utf8")).split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const ROOT = "public/products/WEBSITE KALIMA";
const BUCKET = "product-images";
const SKIP = /sizing chart|video|close ?up|closeup|extra|whatsapp/i;

/* Folder name -> product slug, matching build-catalog-csv.mjs. */
const SLUG = {
  "ITALIAN CHIFFON SHAWL": "italian-chiffon-shawl",
  "KURTA ZAID": "kurta-zaid",
  "KURTA YASIR": "kurta-yasir",
  "ANNA TOP": "anna-top",
  "LUNA PALAZO": "luna-palazzo",
  "ANAYA COTTON": "anaya-cotton",
  "DANISYA SETS": "danisya-set",
  "RUWA CAFTAN": "ruwa-caftan",
  "SERRA SCALLOP": "serra-scallop",
};

/*
  Storage REST directly rather than @supabase/supabase-js: the client pulls in
  realtime-js, which needs a native WebSocket this Node 20 doesn't have. None of
  that is wanted here — this is plain file upload.
*/
const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const auth = { authorization: `Bearer ${KEY}`, apikey: KEY };

const mkBucket = await fetch(`${URL_BASE}/storage/v1/bucket`, {
  method: "POST",
  headers: { ...auth, "content-type": "application/json" },
  body: JSON.stringify({
    id: BUCKET, name: BUCKET, public: true,
    file_size_limit: 10 * 1024 * 1024,
    allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
  }),
});
const mkBody = await mkBucket.text();
if (!mkBucket.ok && !/already exists|Duplicate/i.test(mkBody)) throw new Error(`bucket: ${mkBody}`);
console.log(mkBucket.ok ? `bucket ${BUCKET} created` : `bucket ${BUCKET} already exists`);

const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const fileSlug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const urls = {};
let uploaded = 0;

for (const [folder, slug] of Object.entries(SLUG)) {
  const dir = (await readdir(ROOT, { withFileTypes: true }))
    .find((d) => d.isDirectory() && d.name.trim() === folder)?.name;
  if (!dir) throw new Error(`Missing folder: ${folder}`);

  const files = (await readdir(join(ROOT, dir)))
    .filter((f) => /\.(jpe?g|png)$/i.test(f) && !SKIP.test(f))
    .sort();

  urls[slug] = {};
  for (const f of files) {
    const colour = titleCase(f.replace(/\.(jpe?g|png)$/i, "").replace(/_$/, "").trim());
    const ext = f.toLowerCase().endsWith(".png") ? "png" : "jpg";
    const path = `${slug}/${fileSlug(colour)}.${ext}`;

    const res = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: {
        ...auth,
        "content-type": ext === "png" ? "image/png" : "image/jpeg",
        "cache-control": "31536000",
        "x-upsert": "true",
      },
      body: await readFile(join(ROOT, dir, f)),
    });
    if (!res.ok) throw new Error(`${path}: ${await res.text()}`);

    urls[slug][colour] = `${URL_BASE}/storage/v1/object/public/${BUCKET}/${path}`;
    uploaded++;
  }
  console.log(`  ${slug.padEnd(24)} ${files.length} photos`);
}

await writeFile("scripts/out/image-urls.json", JSON.stringify(urls, null, 2));
console.log(`\n${uploaded} photos uploaded to ${BUCKET}`);
