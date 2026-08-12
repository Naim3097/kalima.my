/*
  Emits the PRODUCTS seed array for src/data/catalog.ts from the same CSV and
  image map that fed the database, so the offline fallback describes the real
  catalogue instead of drifting into its own fiction.

  Prints TypeScript to stdout; paste-replaces the PRODUCTS block.
*/
import { readFile } from "node:fs/promises";

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...rest] = rows.filter((r) => r.some((c) => c !== ""));
  return rest.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const records = parseCsv(await readFile("scripts/out/kalima-catalog.csv", "utf8"));
const images = JSON.parse(await readFile("scripts/out/image-urls.json", "utf8"));

const bySlug = new Map();
for (const r of records) {
  if (!bySlug.has(r.slug)) bySlug.set(r.slug, { head: r, colours: new Map(), sizes: [] });
  const p = bySlug.get(r.slug);
  if (!p.colours.has(r.color_name)) p.colours.set(r.color_name, r.color_hex);
  if (!p.sizes.includes(r.size)) p.sizes.push(r.size);
}

const q = (s) => JSON.stringify(s);
const out = [];
let n = 0;

for (const [slug, p] of bySlug) {
  const h = p.head;
  const colours = [...p.colours].map(([name, hex]) => {
    const url = images[slug]?.[name];
    return `      { name: ${q(name)}, hex: ${q(hex)}${url ? `, image: ${q(url)}` : ""} },`;
  });

  out.push(`  {
    id: "p${++n}",
    slug: ${q(slug)},
    name: ${q(h.name)},
    price: ${Number(h.price_rm)},
    category: ${q(h.category)},
    colors: [
${colours.join("\n")}
    ],
    sizes: [${p.sizes.map(q).join(", ")}],
    fabric: ${q(h.fabric)},
    description: ${q(h.description)},${h.best_seller === "true" ? "\n    bestSeller: true," : ""}
    newArrival: true,
    tone: ${q(h.tone)},
    image: ${q(images[slug]?.[[...p.colours.keys()][0]] ?? "")},
  },`);
}

console.log(`export const PRODUCTS: Product[] = [\n${out.join("\n")}\n];`);
