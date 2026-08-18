/*
  Seed catalog — Phase 1 demo data mirroring the approved mockup.
  Phase 2 swaps these functions to Supabase queries (same signatures).
*/

export type ColorOption = {
  name: string;
  hex: string;
  /** Per-colour photoshoot image — swatch selection swaps to this photo */
  image?: string;
};

/*
  A matching piece offered alongside this one — "Matching Palazzo Pants".

  It is a whole product of its own, already sold separately, so this carries
  only what the PDP needs to render the row and build a cart line from it. The
  colourway is pinned by staff (see the product_addons migration); the SIZE is
  mirrored from whatever the shopper picks on the parent, which is why stock
  arrives as a per-size map rather than a single number.
*/
export type ProductAddon = {
  /** The link row's id — React key and the unit of selection. */
  id: string;
  /** The add-on PRODUCT's id, for the cart line (not the link's). */
  productId: string;
  slug: string;
  /** The staff label if set, else the add-on product's own name. */
  name: string;
  colorName: string;
  colorHex: string;
  image?: string;
  /** Effective price in ringgit — sale price already applied. */
  price: number;
  /** Units on hand per size, for the pinned colourway only. */
  stockBySize: Record<string, number>;
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  /** List price. When salePrice is set this is what gets struck through. */
  price: number;
  /**
   * The "now" price, when the product is on sale. Always below `price`, which
   * the database enforces — so `salePrice != null` alone means "on sale" and
   * no display has to compare the two to find out.
   */
  salePrice?: number;
  /** Product-level size chart image. No colour scope: one per product. */
  sizeChart?: string;
  category: "women" | "men" | "accessories";
  colors: ColorOption[];
  sizes: string[];
  fabric: string;
  description: string;
  bestSeller?: boolean;
  newArrival?: boolean;
  /** Tone used to render the placeholder imagery until photography is supplied */
  tone: string;
  /** Photoshoot image (public path). Falls back to placeholder gradient when absent. */
  image?: string;
  /**
   * Units on hand across every variant. Populated from the database; undefined
   * on the seed fallback, which carries no inventory.
   */
  stock?: number;
  /**
   * Per-variant units on hand, keyed `${colour}|${size}` (see variantKey).
   * Lets the product page refuse a sold-out colour+size before the bag, rather
   * than at the payment step. Undefined on the seed fallback; a missing key is
   * treated as available so the offline demo still works.
   */
  stockByVariant?: Record<string, number>;
  /**
   * Matching pieces offered on this product's page. Loaded only by
   * fetchProductBySlug — the collection grids never render them, so they do
   * not pay for the join. Undefined on the seed fallback.
   */
  addons?: ProductAddon[];
  /**
   * Whether this piece can be tailored to measure. Drives the "Custom sizing"
   * link beside the size guide; off by default, because the link invites a DM
   * the team then has to honour.
   */
  offersCustomSizing?: boolean;
};

/** The key `stockByVariant` is indexed by. One place, so the PDP and the query
 *  layer cannot disagree about the shape. */
export const variantKey = (colour: string, size: string) => `${colour}|${size}`;

/*
  What the shopper actually pays, and what goes in the bag. Every price the
  storefront charges against goes through here, so a sale can never be shown
  on one screen and forgotten on the next. The server re-derives it at order
  creation regardless — this is display and cart arithmetic, not authority.
*/
export const effectivePrice = (p: Pick<Product, "price" | "salePrice">) =>
  p.salePrice ?? p.price;

/** Whole-percent saving, for the "20% off" badge. */
export const discountPercent = (p: Pick<Product, "price" | "salePrice">) =>
  p.salePrice != null && p.price > 0
    ? Math.round((1 - p.salePrice / p.price) * 100)
    : 0;

export const PRODUCTS: Product[] = [
  {
    id: "p1",
    slug: "italian-chiffon-shawl",
    name: "Italian Chiffon Shawl",
    price: 59,
    category: "accessories",
    colors: [
      { name: "Black", hex: "#1f1d1c", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/italian-chiffon-shawl/black.jpg" },
      { name: "Blush", hex: "#c08d80", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/italian-chiffon-shawl/blush.jpg" },
      { name: "Butter", hex: "#efdca4", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/italian-chiffon-shawl/butter.jpg" },
      { name: "Emerald", hex: "#1f4a47", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/italian-chiffon-shawl/emerald.jpg" },
      { name: "Green Apple", hex: "#9fb96a", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/italian-chiffon-shawl/green-apple.jpg" },
      { name: "Latte", hex: "#b08f81", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/italian-chiffon-shawl/latte.jpg" },
      { name: "Magenta", hex: "#a3175e", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/italian-chiffon-shawl/magenta.jpg" },
      { name: "Mocha", hex: "#9c7a6c", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/italian-chiffon-shawl/mocha.jpg" },
      { name: "Raspberry", hex: "#80293b", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/italian-chiffon-shawl/raspberry.jpg" },
      { name: "Steel Blue", hex: "#4b5c70", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/italian-chiffon-shawl/steel-blue.jpg" },
    ],
    sizes: ["Free Size"],
    fabric: "100% premium Italian chiffon",
    description: "Lightweight, airy and softly structured, cut from premium Italian chiffon. Opaque enough for full coverage yet breathable through the day, finished with neat baby-hemmed edges. Generously sized as a long rectangle with curved ends, so it drapes as a hijab, an evening wrap or a neck scarf.\n\nHand wash gently in cold water and air dry. Low-heat iron or steam if needed.",
    bestSeller: true,
    newArrival: true,
    tone: "#1f1d1c",
    image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/italian-chiffon-shawl/black.jpg",
  },
  {
    id: "p2",
    slug: "kurta-zaid",
    name: "Kurta Zaid",
    price: 99,
    category: "men",
    colors: [
      { name: "Black", hex: "#1a1a1a", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/kurta-zaid/black.jpg" },
      { name: "Brick", hex: "#a64523", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/kurta-zaid/brick.jpg" },
      { name: "Green", hex: "#5e5234", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/kurta-zaid/green.jpg" },
      { name: "Grey", hex: "#746e6b", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/kurta-zaid/grey.jpg" },
      { name: "Navy", hex: "#2b3342", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/kurta-zaid/navy.jpg" },
      { name: "Nude", hex: "#ceb5a2", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/kurta-zaid/nude.jpg" },
    ],
    sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
    fabric: "Premium polyester",
    description: "Modern minimalism in premium polyester. Short sleeves and a clean V-neck give Kurta Zaid an easy, everyday finish that carries from morning errands to evening prayers.",
    bestSeller: true,
    newArrival: true,
    tone: "#1a1a1a",
    image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/kurta-zaid/black.jpg",
  },
  {
    id: "p3",
    slug: "kurta-yasir",
    name: "Kurta Yasir",
    price: 125,
    category: "men",
    colors: [
      { name: "Black", hex: "#1a1a1a", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/kurta-yasir/black.jpg" },
      { name: "Cream", hex: "#f1eee7", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/kurta-yasir/cream.jpg" },
      { name: "Green", hex: "#585a3b", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/kurta-yasir/green.jpg" },
      { name: "Grey", hex: "#7e7e7e", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/kurta-yasir/grey.jpg" },
      { name: "Maroon", hex: "#462632", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/kurta-yasir/maroon.jpg" },
      { name: "Navy", hex: "#31394b", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/kurta-yasir/navy.jpg" },
    ],
    sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
    fabric: "Polyester",
    description: "Simplicity at its best. The long-sleeve cut of Kurta Yasir gives a polished, modest finish — the right choice when the occasion asks for something clean and considered.",
    bestSeller: true,
    newArrival: true,
    tone: "#1a1a1a",
    image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/kurta-yasir/black.jpg",
  },
  {
    id: "p4",
    slug: "anna-top",
    name: "Anna Top",
    price: 130,
    category: "women",
    colors: [
      { name: "Dreamy Garden", hex: "#cf8fa0", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/anna-top/dreamy-garden.jpg" },
      { name: "Dusty Lily", hex: "#c08b93", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/anna-top/dusty-lily.jpg" },
      { name: "Lavender Garden", hex: "#c3a3c4", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/anna-top/lavender-garden.jpg" },
      { name: "Peony Garden", hex: "#7a9c86", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/anna-top/peony-garden.jpg" },
      { name: "Polka Black", hex: "#16161a", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/anna-top/polka-black.jpg" },
      { name: "Summer Garden", hex: "#cfa15f", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/anna-top/summer-garden.jpg" },
      { name: "Sunset Garden", hex: "#e0956f", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/anna-top/sunset-garden.jpg" },
      { name: "Vintage Garden", hex: "#c88a63", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/anna-top/vintage-garden.jpg" },
    ],
    sizes: ["Free Size"],
    fabric: "Chiffon",
    description: "A printed chiffon top with flared sleeves and a gathered ruffle hem, cut in one generous free size. Eight prints, each its own garden.\n\nFree size: shoulder 15\", bust 50\", armhole 20\", sleeve length 21\", top length 26\".",
    newArrival: true,
    tone: "#cf8fa0",
    image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/anna-top/dreamy-garden.jpg",
  },
  {
    id: "p5",
    slug: "luna-palazzo",
    name: "Luna Palazo",
    price: 170,
    category: "women",
    colors: [
      { name: "Magenta", hex: "#a75082", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/luna-palazzo/magenta.jpg" },
      { name: "Maroon", hex: "#9c2a41", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/luna-palazzo/maroon.jpg" },
      { name: "Sand", hex: "#c8bcb0", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/luna-palazzo/sand.jpg" },
      { name: "Teal Blue", hex: "#5b7a95", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/luna-palazzo/teal-blue.jpg" },
      { name: "Teal Green", hex: "#456f89", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/luna-palazzo/teal-green.jpg" },
    ],
    sizes: ["S/M", "L/XL"],
    fabric: "Chiffon, fully lined",
    description: "Wide-leg palazzo trousers cut from breathable chiffon, with a high-rise waist and a sweeping silhouette that lengthens every stride. Fully stitched soft inner lining means zero transparency and a smooth drape — dress them up with a silk blouse or down with a plain tee.",
    bestSeller: true,
    newArrival: true,
    tone: "#a75082",
    image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/luna-palazzo/magenta.jpg",
  },
  {
    id: "p6",
    slug: "anaya-cotton",
    name: "Anaya Cotton",
    price: 200,
    category: "women",
    colors: [
      { name: "Code 1", hex: "#9cb9a4", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/anaya-cotton/code-1.jpg" },
      { name: "Code 2", hex: "#7ba7b0", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/anaya-cotton/code-2.jpg" },
    ],
    sizes: ["S/M", "L/XL"],
    fabric: "100% breathable cotton",
    description: "A two-piece set in natural cotton that keeps its cool from morning to night. The top takes a classic round neck with a refined front slit and side slits; the bottoms are tailored bell-bottoms with a flattering retro line. Wear it as a set, or split it across the rest of your wardrobe.",
    newArrival: true,
    tone: "#9cb9a4",
    image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/anaya-cotton/code-1.jpg",
  },
  {
    id: "p7",
    slug: "danisya-set",
    name: "Danisya Sets",
    price: 200,
    category: "women",
    colors: [
      { name: "Black", hex: "#151d27", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/danisya-set/black.jpg" },
      { name: "Burgundy", hex: "#741c34", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/danisya-set/burgundy.jpg" },
      { name: "Cream", hex: "#f1f1e9", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/danisya-set/cream.jpg" },
      { name: "Kelly Green", hex: "#656b16", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/danisya-set/kelly-green.jpg" },
      { name: "Magenta", hex: "#be1a84", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/danisya-set/magenta.jpg" },
      { name: "Mocha", hex: "#a08663", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/danisya-set/mocha.jpg" },
      { name: "Sand Beige", hex: "#d9d6d5", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/danisya-set/sand-beige.jpg" },
      { name: "Silver", hex: "#bbc2c5", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/danisya-set/silver.jpg" },
      { name: "Teal Green", hex: "#017d95", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/danisya-set/teal-green.jpg" },
    ],
    sizes: ["S/M", "L/XL"],
    fabric: "Premium satin",
    description: "Premium satin with a silky, fluid drape. The high-neck top is finished with a single-button closure at the back, its flare sleeves adding movement through the arm; matching bell-bottom palazzo trousers complete the line. Made for a formal evening, worn with understated glamour.",
    bestSeller: true,
    newArrival: true,
    tone: "#151d27",
    image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/danisya-set/black.jpg",
  },
  {
    id: "p8",
    slug: "ruwa-caftan",
    name: "Ruwa Caftan",
    price: 250,
    category: "women",
    colors: [
      { name: "Black", hex: "#252524", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/ruwa-caftan/black.jpg" },
      { name: "Burgundy", hex: "#8d2d33", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/ruwa-caftan/burgundy.jpg" },
      { name: "Cream", hex: "#e9efea", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/ruwa-caftan/cream.jpg" },
      { name: "Kelly Green", hex: "#6f7122", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/ruwa-caftan/kelly-green.jpg" },
      { name: "Magenta", hex: "#af3367", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/ruwa-caftan/magenta.jpg" },
      { name: "Mocha", hex: "#a5805f", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/ruwa-caftan/mocha.jpg" },
      { name: "Silver", hex: "#bec5c6", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/ruwa-caftan/silver.jpg" },
      { name: "Teal Green", hex: "#2b868b", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/ruwa-caftan/teal-green.jpg" },
    ],
    sizes: ["S/M", "L/XL"],
    fabric: "Premium satin",
    description: "Luxury and comfort in one piece. Cut from premium satin that drapes beautifully against the skin with a lustrous finish, the Ruwa Caftan balances a deep V-neckline against a relaxed, modest line. Breastfeeding-friendly, so nothing is traded away for style.",
    newArrival: true,
    tone: "#252524",
    image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/ruwa-caftan/black.jpg",
  },
  {
    id: "p9",
    slug: "serra-scallop",
    name: "Serra Scallop",
    price: 395,
    category: "women",
    colors: [
      { name: "Black", hex: "#161b27", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/serra-scallop/black.jpg" },
      { name: "Burgundy", hex: "#631934", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/serra-scallop/burgundy.jpg" },
      { name: "Kelly Green", hex: "#71753c", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/serra-scallop/kelly-green.jpg" },
      { name: "Magenta", hex: "#792660", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/serra-scallop/magenta.jpg" },
      { name: "Mocha", hex: "#a1826b", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/serra-scallop/mocha.jpg" },
      { name: "Teal Blue", hex: "#46617a", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/serra-scallop/teal-blue.jpg" },
      { name: "Teal Green", hex: "#126c82", image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/serra-scallop/teal-green.jpg" },
    ],
    sizes: ["S", "M", "L-XL"],
    fabric: "Embroidery cardigan over premium satin",
    description: "A cardigan abaya in two layers: a scalloped embroidery cardigan over a premium satin inner. The inner carries a hidden zip and is breastfeeding-friendly, cut an inch shorter than the cardigan through the armhole, sleeve and hem so the scalloped edge reads clearly.\n\nAvailable in S, M and L-XL.",
    newArrival: true,
    tone: "#161b27",
    image: "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/serra-scallop/black.jpg",
  },
];

export type NavItem = {
  label: string;
  to: string;
  children?: { label: string; to: string }[];
};

/*
  Trimmed to what the catalogue actually holds: 6 women's pieces, 2 kurtas, and
  the shawl. Dropdowns and the Signature / Fabrics / Raya sections came back
  when there were 13 seeded products behind them — with nine real ones, a
  sub-menu of one item is a dead end, so every entry here leads somewhere real.
  Add sections back as those ranges launch.
*/
export const NAV: NavItem[] = [
  { label: "Women", to: "/collections/women" },
  { label: "Men", to: "/collections/men" },
  { label: "Accessories", to: "/collections/accessories" },
  { label: "New Arrivals", to: "/collections/new-arrivals" },
  { label: "About Kalima", to: "/pages/about-kalima" },
];

export const ANNOUNCEMENTS = [
  "WORLDWIDE DELIVERY — shipping calculated at checkout",
  "New: Serra Scallop — scalloped embroidery over premium satin",
  "Join Kalima Club for exclusive offers & private sales",
];

/* One slide for now. The copy deliberately names no collection: the range is
   the nine pieces in the catalogue, and a hero advertising a line we don't
   stock is how a discontinued name survives on the homepage for months. */
export const HERO_SLIDES = [
  {
    eyebrow: "New Arrivals",
    title: "Timeless Modest Luxury",
    body: "Designed in Malaysia. Cut from premium satin, chiffon and cotton.",
    primary: { label: "New Collection", to: "/collections/new-arrivals" },
    secondary: { label: "Shop Collections", to: "/collections/women" },
    image:
      "https://gylsymfonxyegdlfodvk.supabase.co/storage/v1/object/public/product-images/ruwa-caftan/kelly-green.jpg",
    focal: "center 25%",
  },
];

export const USPS = [
  { icon: "flag", title: "Made in Malaysia", body: "Proudly local, globally loved." },
  { icon: "fabric", title: "Premium Fabrics", body: "In-house fabric for the finest quality." },
  { icon: "scissors", title: "In-house Design", body: "Thoughtfully designed for every detail." },
  { icon: "sizes", title: "Inclusive Sizing", body: "Multiple sizes for every woman." },
  { icon: "leaf", title: "Sustainable Fashion", body: "Responsible choices for a better tomorrow." },
] as const;

/*
  Collection metadata as the UI consumes it — plain data, so it crosses the
  server/client boundary and JSON-serialises cleanly.
*/
export type CollectionMeta = {
  slug: string;
  title: string;
  description: string;
};

/*
  The seed definition additionally carries the membership predicate. It is used
  only by scripts/generate-seed.mts to compute collection_products rows, and by
  the seed fallback below — never by the UI, which reads membership from the
  database. Keeping `filter` off CollectionMeta is what makes that type
  serialisable.
*/
export type SeedCollection = CollectionMeta & {
  filter: (p: Product) => boolean;
};

export const COLLECTIONS: SeedCollection[] = [
  { slug: "women", title: "Women", description: "Caftans, sets, tops and palazzo trousers.", filter: (p) => p.category === "women" },
  { slug: "men", title: "Men", description: "Kurta cut for everyday wear.", filter: (p) => p.category === "men" },
  { slug: "accessories", title: "Accessories", description: "Shawls and finishing touches.", filter: (p) => p.category === "accessories" },
  { slug: "best-sellers", title: "Best Sellers", description: "The pieces our community loves most.", filter: (p) => !!p.bestSeller },
  { slug: "new-arrivals", title: "New Arrivals", description: "Fresh from the Kalima atelier.", filter: (p) => !!p.newArrival },
];

/*
  Data access moved to src/data/catalog.queries.ts, which reads Supabase.
  This module stays free of server imports so client components can keep
  importing the types and the CMS content above.
*/
