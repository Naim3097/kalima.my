/*
  Emits supabase/seed.sql from the seed catalog in src/data/catalog.ts.

  Generated rather than hand-written so the database seed cannot drift from
  the data the app renders today. Re-run after editing the catalog:

    npm run seed:generate

  Requires Node 22+ (native TypeScript stripping).
*/
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PRODUCTS, COLLECTIONS } from "../src/data/catalog.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Single-quote escaping for SQL string literals. */
const q = (value: string | undefined | null) =>
  value == null ? "null" : `'${value.replace(/'/g, "''")}'`;

/** Storefront prices are whole ringgit; the DB stores sen (§4.2 money integrity). */
const sen = (ringgit: number) => Math.round(ringgit * 100);

// SKUs are built by the generated SQL itself (see the variants block below),
// so the rule lives in exactly one place: KLM-<SLUG>-<COLOUR>-<SIZE>,
// uppercased with non-alphanumerics stripped.

const lines: string[] = [
  "-- GENERATED FILE — do not edit by hand.",
  "-- Source: src/data/catalog.ts · Regenerate: npm run seed:generate",
  "",
  "begin;",
  "",
  "-- Idempotent: truncate cascades through variants, images and membership.",
  "truncate table products, collections restart identity cascade;",
  "",
];

// --- Collections -----------------------------------------------------------
lines.push("-- Collections");
COLLECTIONS.forEach((collection, index) => {
  // "Smart" collections are derived from product flags rather than membership rows.
  const isSmart = ["best-sellers", "new-arrivals", "signature"].includes(collection.slug);
  lines.push(
    `insert into collections (slug, title, description, is_smart, sort_order) values (` +
      `${q(collection.slug)}, ${q(collection.title)}, ${q(collection.description)}, ` +
      `${isSmart}, ${index});`,
  );
});
lines.push("");

// --- Products --------------------------------------------------------------
lines.push("-- Products");
lines.push(
  "insert into products (slug, name, description, fabric, category, price_sen, best_seller, new_arrival, tone) values",
);
lines.push(
  PRODUCTS.map(
    (p) =>
      `  (${q(p.slug)}, ${q(p.name)}, ${q(p.description)}, ${q(p.fabric)}, ` +
      `${q(p.category)}::product_category, ${sen(p.price)}, ` +
      `${!!p.bestSeller}, ${!!p.newArrival}, ${q(p.tone)})`,
  ).join(",\n") + ";",
);
lines.push("");

/*
  Variants are the colour × size matrix — 188 rows. Rather than enumerate every
  one, declare each product's colour and size lists once and let Postgres build
  the cross product. The SKU rule lives only here, in SQL:
  KLM-<SLUG>-<COLOUR>-<SIZE>, uppercased with non-alphanumerics stripped.
*/
lines.push("-- Variants: colour × size per product");
lines.push("with spec (slug, colors, sizes) as (values");
lines.push(
  PRODUCTS.map(
    (p) =>
      `  (${q(p.slug)}, ` +
      `${q(JSON.stringify(p.colors.map((c) => ({ name: c.name, hex: c.hex }))))}::jsonb, ` +
      `array[${p.sizes.map(q).join(", ")}]::text[])`,
  ).join(",\n") + "\n)",
);
lines.push(`insert into product_variants (product_id, sku, color_name, color_hex, size, color_position, position)
select
  p.id,
  'KLM-' || upper(p.slug)
        || '-' || upper(regexp_replace(c.obj ->> 'name', '[^A-Za-z0-9]', '', 'g'))
        || '-' || upper(regexp_replace(s.size, '[^A-Za-z0-9]', '', 'g')),
  c.obj ->> 'name',
  c.obj ->> 'hex',
  s.size,
  c.cord - 1,
  s.ord - 1
from spec
join products p on p.slug = spec.slug
cross join lateral jsonb_array_elements(spec.colors) with ordinality as c(obj, cord)
cross join lateral unnest(spec.sizes) with ordinality as s(size, ord);

-- Demo stock, deterministic from the SKU so re-seeding reproduces it exactly.
-- 0..4 per variant leaves some sizes genuinely out of stock. Replace with real
-- counts via the stock_movements ledger in Phase 2.
update product_variants set stock_on_hand = abs(hashtext(sku)) % 5;`);
lines.push("");

// --- Images ---------------------------------------------------------------
// The product-level shot, plus any per-colour shots that drive the swatch swap.
const imageRows: string[] = [];
for (const product of PRODUCTS) {
  if (product.image) {
    imageRows.push(
      `  ((select id from products where slug = ${q(product.slug)}), ${q(product.image)}, ` +
        `${q(product.name)}, null, 0)`,
    );
  }
  product.colors.forEach((color, colorIndex) => {
    if (!color.image) return;
    imageRows.push(
      `  ((select id from products where slug = ${q(product.slug)}), ${q(color.image)}, ` +
        `${q(`${product.name} — ${color.name}`)}, ${q(color.name)}, ${colorIndex + 1})`,
    );
  });
}
if (imageRows.length) {
  lines.push("-- Images");
  lines.push(
    "insert into product_images (product_id, url, alt, color_name, position) values",
    `${imageRows.join(",\n")};`,
    "",
  );
}

// --- Curated collection membership ----------------------------------------
lines.push("-- Curated collection membership (smart collections derive from flags instead)");
for (const collection of COLLECTIONS) {
  if (["best-sellers", "new-arrivals", "signature"].includes(collection.slug)) continue;
  const members = PRODUCTS.filter(collection.filter);
  if (!members.length) continue;

  const rows = members.map(
    (product, index) =>
      `  ((select id from collections where slug = ${q(collection.slug)}), ` +
      `(select id from products where slug = ${q(product.slug)}), ${index})`,
  );
  lines.push(
    "insert into collection_products (collection_id, product_id, sort_order) values",
    `${rows.join(",\n")};`,
  );
}

lines.push("", "commit;", "");

const out = join(root, "supabase", "seed.sql");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join("\n"), "utf8");

const variantCount = PRODUCTS.reduce(
  (total, p) => total + p.colors.length * p.sizes.length,
  0,
);
console.log(
  `Wrote supabase/seed.sql — ${COLLECTIONS.length} collections, ` +
    `${PRODUCTS.length} products, ${variantCount} variants.`,
);
