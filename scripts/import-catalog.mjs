/*
  Writes the catalogue from kalima-catalog.csv into Supabase, mirroring the
  logic in importCatalogCsv (src/app/admin/actions.ts) so the result is
  identical to importing the same file through /admin/sync:
    - products matched by slug, updated or inserted
    - variants matched by SKU (then colour+size), colour/size order following
      first appearance in the file
    - stock left at 0, so nothing needs to move through the ledger

  Then fills product_images from image-urls.json: one product-level shot with
  no colour scope, plus a per-colour shot for every colourway, which is what
  drives the swatch-click image swap.

  Idempotent — safe to re-run. Pass --dry to print the plan and write nothing.
*/
import { readFile } from "node:fs/promises";
import { parse } from "node:path";

const DRY = process.argv.includes("--dry");

for (const line of (await readFile(".env.local", "utf8")).split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function rest(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${BASE}/${path}`, {
    method,
    headers: {
      apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json",
      ...(prefer ? { prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${text}`);
  return text ? JSON.parse(text) : null;
}

/* Minimal RFC4180 reader — descriptions contain commas and newlines. */
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

const rmToSen = (v) => Math.round(Number(String(v).replace(/[^0-9.]/g, "")) * 100);
const records = parseCsv(await readFile("scripts/out/kalima-catalog.csv", "utf8"));
const images = JSON.parse(await readFile("scripts/out/image-urls.json", "utf8"));

/* Group by product, preserving file order. */
const groups = new Map();
for (const r of records) {
  if (!groups.has(r.slug)) groups.set(r.slug, []);
  groups.get(r.slug).push(r);
}

console.log(`${records.length} variant rows across ${groups.size} products${DRY ? "  (dry run)" : ""}\n`);

let productsCreated = 0, productsUpdated = 0, variantsCreated = 0, variantsUpdated = 0, imagesWritten = 0;

for (const [slug, rows] of groups) {
  const head = rows[0];
  const productRow = {
    name: head.name, slug,
    description: head.description.trim() || null,
    fabric: head.fabric.trim() || null,
    category: head.category,
    price_sen: rmToSen(head.price_rm),
    best_seller: head.best_seller === "true",
    new_arrival: head.new_arrival === "true",
    tone: head.tone,
    published: head.published === "true",
  };

  if (DRY) {
    console.log(`  ${slug.padEnd(24)} ${rows.length} variants  RM${head.price_rm}  ${head.category}`);
    continue;
  }

  const [existing] = await rest(`products?slug=eq.${slug}&select=id`);
  let productId;
  if (existing) {
    await rest(`products?id=eq.${existing.id}`, { method: "PATCH", body: productRow });
    productId = existing.id;
    productsUpdated++;
  } else {
    const [created] = await rest("products", { method: "POST", body: productRow, prefer: "return=representation" });
    productId = created.id;
    productsCreated++;
  }

  const current = await rest(`product_variants?product_id=eq.${productId}&select=id,sku,color_name,size`);
  const bySku = new Map(current.map((v) => [v.sku.toUpperCase(), v]));
  const byCs = new Map(current.map((v) => [`${v.color_name.toLowerCase()}|${v.size.toLowerCase()}`, v]));

  const colorOrder = new Map();
  let nextPosition = current.length;
  const toInsert = [];

  for (const r of rows) {
    if (!colorOrder.has(r.color_name.toLowerCase())) colorOrder.set(r.color_name.toLowerCase(), colorOrder.size);
    const match = bySku.get(r.sku.toUpperCase()) ?? byCs.get(`${r.color_name.toLowerCase()}|${r.size.toLowerCase()}`);

    const fields = {
      sku: r.sku, color_name: r.color_name, color_hex: r.color_hex, size: r.size,
      price_sen: r.variant_price_rm ? rmToSen(r.variant_price_rm) : null,
      weight_grams: Number(r.weight_grams),
    };

    if (match) {
      await rest(`product_variants?id=eq.${match.id}`, { method: "PATCH", body: fields });
      variantsUpdated++;
    } else {
      toInsert.push({
        ...fields, product_id: productId, stock_on_hand: 0,
        color_position: colorOrder.get(r.color_name.toLowerCase()),
        position: nextPosition++,
      });
    }
  }
  if (toInsert.length) {
    await rest("product_variants", { method: "POST", body: toInsert });
    variantsCreated += toInsert.length;
  }

  /* Photos: rebuild rather than append, so re-runs don't stack duplicates. */
  const urls = images[slug] ?? {};
  const colours = [...new Set(rows.map((r) => r.color_name))];
  await rest(`product_images?product_id=eq.${productId}`, { method: "DELETE" });

  const imageRows = [];
  const first = urls[colours[0]];
  if (first) imageRows.push({ product_id: productId, url: first, color_name: null, position: 0, alt: head.name });
  colours.forEach((colour, i) => {
    if (urls[colour]) {
      imageRows.push({
        product_id: productId, url: urls[colour], color_name: colour,
        position: i + 1, alt: `${head.name} in ${colour}`,
      });
    }
  });
  if (imageRows.length) {
    await rest("product_images", { method: "POST", body: imageRows });
    imagesWritten += imageRows.length;
  }

  console.log(`  ${slug.padEnd(24)} ${rows.length} variants, ${imageRows.length} photos`);
}

if (!DRY) {
  console.log(
    `\nproducts: ${productsCreated} created, ${productsUpdated} updated` +
    `\nvariants: ${variantsCreated} created, ${variantsUpdated} updated` +
    `\nphotos:   ${imagesWritten} rows`
  );
}
