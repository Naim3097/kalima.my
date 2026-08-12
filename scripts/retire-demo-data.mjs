/*
  Retires the seeded demo catalogue and the test orders that reference it,
  leaving only the nine real products.

  Everything is written to scripts/out/demo-snapshot.json before a single row is
  deleted — the delete is irreversible, the snapshot is what makes it survivable.

  Deletion order follows the foreign keys inward: order items and stock
  movements before variants, variants before products.

  Pass --dry to see the counts and write nothing.
*/
import { readFile, writeFile } from "node:fs/promises";

const DRY = process.argv.includes("--dry");

for (const line of (await readFile(".env.local", "utf8")).split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function rest(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}/${path}`, {
    method,
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const KEEP = [
  "italian-chiffon-shawl", "kurta-zaid", "kurta-yasir", "anna-top", "luna-palazzo",
  "anaya-cotton", "danisya-set", "ruwa-caftan", "serra-scallop",
];
const inList = (xs) => `(${xs.map((x) => `"${x}"`).join(",")})`;

/* The demo products, and the demo colourways left on luna-palazzo — that slug
   collided with a seeded product, so the real one carries stale variants. */
const demoProducts = await rest(`products?slug=not.in.${inList(KEEP)}&select=*`);
const demoIds = demoProducts.map((p) => p.id);

const staleLuna = await rest(
  `product_variants?select=*,products!inner(slug)&products.slug=eq.luna-palazzo&sku=like.KLM-LUNA-PALAZZO-*`
);

const demoVariants = demoIds.length
  ? await rest(`product_variants?product_id=in.${inList(demoIds)}&select=*`)
  : [];
const variantIds = [...demoVariants.map((v) => v.id), ...staleLuna.map((v) => v.id)];

const orderItems = variantIds.length
  ? await rest(`order_items?product_variant_id=in.${inList(variantIds)}&select=*`)
  : [];
const orderIds = [...new Set(orderItems.map((i) => i.order_id))];
const orders = orderIds.length ? await rest(`orders?id=in.${inList(orderIds)}&select=*`) : [];
const movements = variantIds.length
  ? await rest(`stock_movements?product_variant_id=in.${inList(variantIds)}&select=*`)
  : [];
const images = demoIds.length
  ? await rest(`product_images?product_id=in.${inList(demoIds)}&select=*`)
  : [];
const collectionLinks = demoIds.length
  ? await rest(`collection_products?product_id=in.${inList(demoIds)}&select=*`)
  : [];

const snapshot = {
  _taken: new Date().toISOString(),
  _why: "Seeded demo catalogue and test orders, removed once the nine real products were live.",
  products: demoProducts, variants: demoVariants, staleLunaVariants: staleLuna,
  orders, orderItems, stockMovements: movements, productImages: images, collectionLinks,
};

console.log(
  `products ${demoProducts.length}\nvariants ${demoVariants.length} (+${staleLuna.length} stale on luna-palazzo)\n` +
  `orders ${orders.length}\norder items ${orderItems.length}\nstock movements ${movements.length}\n` +
  `images ${images.length}\ncollection links ${collectionLinks.length}`
);
if (DRY) { console.log("\ndry run — nothing deleted"); process.exit(0); }

await writeFile("scripts/out/demo-snapshot.json", JSON.stringify(snapshot, null, 2));
console.log("\nsnapshot written to scripts/out/demo-snapshot.json");

/* Inward along the foreign keys. */
if (orderItems.length) await rest(`order_items?product_variant_id=in.${inList(variantIds)}`, { method: "DELETE" });
if (orderIds.length) await rest(`orders?id=in.${inList(orderIds)}`, { method: "DELETE" });
if (variantIds.length) {
  await rest(`stock_movements?product_variant_id=in.${inList(variantIds)}`, { method: "DELETE" });
  await rest(`channel_listings?variant_id=in.${inList(variantIds)}`, { method: "DELETE" });
  await rest(`channel_sync_log?variant_id=in.${inList(variantIds)}`, { method: "DELETE" });
  await rest(`product_variants?id=in.${inList(variantIds)}`, { method: "DELETE" });
}
if (demoIds.length) {
  await rest(`product_images?product_id=in.${inList(demoIds)}`, { method: "DELETE" });
  await rest(`collection_products?product_id=in.${inList(demoIds)}`, { method: "DELETE" });
  await rest(`products?id=in.${inList(demoIds)}`, { method: "DELETE" });
}

const left = await rest("products?select=slug&order=slug");
console.log(`\ndeleted. ${left.length} products remain: ${left.map((p) => p.slug).join(", ")}`);
