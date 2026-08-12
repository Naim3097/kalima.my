/*
  Builds the catalogue import CSV from the two sources of truth:
    - public/products/WEBSITE KALIMA/*  which products and colourways exist
    - scripts/out/swatches.final.json   the swatch hex for each colourway

  Everything else (price, sizes, fabric, copy) is recorded below, taken from the
  Shopee listings and the sizing chart in each folder. One row per variant, in
  the shape src/lib/catalog-csv.ts defines, so it imports through /admin/sync.

  Output: scripts/out/kalima-catalog.csv
*/
import { readFile, writeFile } from "node:fs/promises";

const SIX = ["S", "M", "L", "XL", "2XL", "3XL"];
const PAIR = ["S/M", "L/XL"];
const FREE = ["Free Size"];

/*
  best_seller drives the homepage grid. These are Shopee's own top-sellers
  ranking captured from the shop page (TOP 1-5), not a guess.
  new_arrival is true throughout — every listing carries Shopee's New Arrival tag.
  weight_grams are ESTIMATES by garment type; they feed courier rating, so they
  want checking against a real parcel before launch.
*/
const PRODUCTS = [
  {
    folder: "ITALIAN CHIFFON SHAWL", slug: "italian-chiffon-shawl", name: "Italian Chiffon Shawl",
    category: "accessories", rm: 59, sizes: FREE, weight: 120, bestSeller: true,
    fabric: "100% premium Italian chiffon",
    description:
      "Lightweight, airy and softly structured, cut from premium Italian chiffon. Opaque enough for full coverage yet breathable through the day, finished with neat baby-hemmed edges. Generously sized as a long rectangle with curved ends, so it drapes as a hijab, an evening wrap or a neck scarf.\n\nHand wash gently in cold water and air dry. Low-heat iron or steam if needed.",
  },
  {
    folder: "KURTA ZAID", slug: "kurta-zaid", name: "Kurta Zaid",
    category: "men", rm: 99, sizes: SIX, weight: 300, bestSeller: true,
    fabric: "Premium polyester",
    description:
      "Modern minimalism in premium polyester. Short sleeves and a clean V-neck give Kurta Zaid an easy, everyday finish that carries from morning errands to evening prayers.",
  },
  {
    folder: "KURTA YASIR", slug: "kurta-yasir", name: "Kurta Yasir",
    category: "men", rm: 125, sizes: SIX, weight: 340, bestSeller: true,
    fabric: "Polyester",
    description:
      "Simplicity at its best. The long-sleeve cut of Kurta Yasir gives a polished, modest finish — the right choice when the occasion asks for something clean and considered.",
  },
  {
    folder: "ANNA TOP", slug: "anna-top", name: "Anna Top",
    category: "women", rm: 130, sizes: FREE, weight: 260, newArrival: true,
    fabric: "Chiffon",
    description:
      "A printed chiffon top with flared sleeves and a gathered ruffle hem, cut in one generous free size. Eight prints, each its own garden.\n\nFree size: shoulder 15\", bust 50\", armhole 20\", sleeve length 21\", top length 26\".",
  },
  {
    folder: "LUNA PALAZO", slug: "luna-palazzo", name: "Luna Palazo",
    category: "women", rm: 170, sizes: PAIR, weight: 380, bestSeller: true,
    fabric: "Chiffon, fully lined",
    description:
      "Wide-leg palazzo trousers cut from breathable chiffon, with a high-rise waist and a sweeping silhouette that lengthens every stride. Fully stitched soft inner lining means zero transparency and a smooth drape — dress them up with a silk blouse or down with a plain tee.",
  },
  {
    folder: "ANAYA COTTON", slug: "anaya-cotton", name: "Anaya Cotton",
    category: "women", rm: 200, sizes: PAIR, weight: 520,
    fabric: "100% breathable cotton",
    description:
      "A two-piece set in natural cotton that keeps its cool from morning to night. The top takes a classic round neck with a refined front slit and side slits; the bottoms are tailored bell-bottoms with a flattering retro line. Wear it as a set, or split it across the rest of your wardrobe.",
  },
  {
    folder: "DANISYA SETS", slug: "danisya-set", name: "Danisya Sets",
    category: "women", rm: 200, sizes: PAIR, weight: 560, bestSeller: true,
    fabric: "Premium satin",
    description:
      "Premium satin with a silky, fluid drape. The high-neck top is finished with a single-button closure at the back, its flare sleeves adding movement through the arm; matching bell-bottom palazzo trousers complete the line. Made for a formal evening, worn with understated glamour.",
  },
  {
    folder: "RUWA CAFTAN", slug: "ruwa-caftan", name: "Ruwa Caftan",
    category: "women", rm: 250, sizes: PAIR, weight: 460,
    fabric: "Premium satin",
    description:
      "Luxury and comfort in one piece. Cut from premium satin that drapes beautifully against the skin with a lustrous finish, the Ruwa Caftan balances a deep V-neckline against a relaxed, modest line. Breastfeeding-friendly, so nothing is traded away for style.",
  },
  {
    folder: "SERRA SCALLOP", slug: "serra-scallop", name: "Serra Scallop",
    category: "women", rm: 395, sizes: ["S", "M", "L-XL"], weight: 700,
    fabric: "Embroidery cardigan over premium satin",
    description:
      "A cardigan abaya in two layers: a scalloped embroidery cardigan over a premium satin inner. The inner carries a hidden zip and is breastfeeding-friendly, cut an inch shorter than the cardigan through the armhole, sleeve and hem so the scalloped edge reads clearly.\n\nAvailable in S, M and L-XL.",
  },
];

const swatches = JSON.parse(await readFile("scripts/out/swatches.final.json", "utf8"));

const skuPart = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const HEADER = [
  "slug", "name", "description", "fabric", "category", "price_rm", "best_seller",
  "new_arrival", "tone", "published", "sku", "color_name", "color_hex", "size",
  "variant_price_rm", "weight_grams", "stock",
];

const rows = [HEADER];
let variants = 0;

for (const p of PRODUCTS) {
  const colours = swatches[p.folder];
  if (!colours) throw new Error(`No swatches for ${p.folder}`);
  const names = Object.keys(colours);

  /* The placeholder gradient shown before photography loads: use the product's
     own first colourway so it never flashes an unrelated hue. */
  const tone = colours[names[0]].hex;

  for (const colour of names) {
    const hex = colours[colour].hex;
    /* Title Case the folder's shouty filenames for display. */
    const display = colour.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

    for (const size of p.sizes) {
      rows.push([
        p.slug, p.name, p.description, p.fabric, p.category, p.rm,
        p.bestSeller ? "true" : "false",
        "true",                       // every listing carries Shopee's New Arrival tag
        tone, "true",
        `KLM-${skuPart(p.slug)}-${skuPart(colour)}-${skuPart(size)}`,
        display, hex, size,
        "",                           // blank = inherit the product price
        p.weight, "0",                // stock 0 everywhere, per the stock-take decision
      ]);
      variants++;
    }
  }
}

await writeFile("scripts/out/kalima-catalog.csv", rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n");

console.log(`scripts/out/kalima-catalog.csv — ${PRODUCTS.length} products, ${variants} variants`);
for (const p of PRODUCTS) {
  const n = Object.keys(swatches[p.folder]).length;
  console.log(`  ${p.name.padEnd(24)} ${String(n).padStart(2)} colours x ${p.sizes.length} sizes = ${String(n * p.sizes.length).padStart(3)}  RM${p.rm}`);
}
