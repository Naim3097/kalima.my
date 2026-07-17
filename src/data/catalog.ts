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

export type Product = {
  id: string;
  slug: string;
  name: string;
  price: number;
  category: "women" | "men" | "accessories";
  collection?: "maya" | "amanda" | "luna" | "raya";
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
};

export const PRODUCTS: Product[] = [
  {
    id: "p1",
    slug: "maya-luna",
    name: "Maya Luna",
    price: 295,
    category: "women",
    collection: "luna",
    colors: [
      { name: "Noir", hex: "#1f1d20" },
      { name: "Blush", hex: "#d8a8a0" },
      { name: "Mauve", hex: "#b98d95" },
    ],
    sizes: ["XS", "S", "M", "L", "XL", "2XL"],
    fabric: "Premium luxury chiffon, double-lined",
    description:
      "An evening abaya cut for movement — flowing luxury chiffon with a soft matte finish, subtle embroidered cuffs and a full modest silhouette.",
    bestSeller: true,
    tone: "#2b2733",
  },
  {
    id: "p2",
    slug: "maya-chiffon",
    name: "Maya Chiffon",
    price: 250,
    category: "women",
    collection: "maya",
    colors: [
      { name: "Blush Floral", hex: "#e7cfc7" },
      { name: "Sage", hex: "#a9b39b" },
      { name: "Ivory", hex: "#efe9dd" },
      { name: "Taupe", hex: "#b3a294" },
    ],
    sizes: ["XS", "S", "M", "L", "XL", "2XL"],
    fabric: "Luxury chiffon, breathable inner lining",
    description:
      "The signature Maya drape. Effortless elegance in luxury chiffon, crafted with premium fabric and finished with hand-rolled hems.",
    bestSeller: true,
    newArrival: true,
    tone: "#e7cfc7",
    image: "/products/maya-chiffon.jpg",
  },
  {
    id: "p3",
    slug: "amanda-sparkle",
    name: "Amanda Sparkle",
    price: 250,
    category: "women",
    collection: "amanda",
    colors: [
      { name: "Noir", hex: "#1f1d20" },
      { name: "Olive", hex: "#5b6247" },
      { name: "Mauve", hex: "#b28c96" },
    ],
    sizes: ["S", "M", "L", "XL"],
    fabric: "Ribbed jersey with stretch, fully opaque",
    description:
      "The city dress — a fitted mock-neck maxi in heavyweight ribbed jersey that skims without clinging. From gallery mornings to dinner, one piece.",
    bestSeller: true,
    tone: "#1f1d20",
    image: "/products/amanda-sparkle.jpg",
  },
  {
    id: "p11",
    slug: "bella-dress",
    name: "Bella Dress",
    price: 289,
    category: "women",
    collection: "raya",
    colors: [
      { name: "Maroon", hex: "#6b2231" },
      { name: "Midnight", hex: "#383c61" },
      { name: "Emerald", hex: "#2f5d50" },
    ],
    sizes: ["XS", "S", "M", "L", "XL", "2XL"],
    fabric: "Beaded lace kebaya top with batik-print skirt",
    description:
      "Heritage, reimagined — a beaded lace kebaya in deep maroon over a flowing batik-print skirt. Made for Raya mornings and wedding evenings alike.",
    bestSeller: true,
    newArrival: true,
    tone: "#6b2231",
    image: "/products/bella-dress.jpg",
  },
  {
    id: "p12",
    slug: "sofea-dress",
    name: "Sofea Dress",
    price: 269,
    category: "women",
    collection: "maya",
    colors: [
      { name: "Ivory Floral", hex: "#ece2d4" },
      { name: "Blush", hex: "#d8b4ad" },
      { name: "Sage", hex: "#a9b39b" },
    ],
    sizes: ["XS", "S", "M", "L", "XL", "2XL"],
    fabric: "Watercolour floral crepe, puff shoulder",
    description:
      "Soft watercolour blooms on ivory crepe — the Sofea falls straight and graceful with a gently structured shoulder. Quietly romantic, endlessly wearable.",
    bestSeller: true,
    newArrival: true,
    tone: "#ece2d4",
    image: "/products/sofea-dress.jpg",
  },
  {
    id: "p13",
    slug: "ruwa-kaftan",
    name: "Ruwa Kaftan",
    price: 259,
    category: "women",
    collection: "amanda",
    colors: [
      { name: "Peach Bloom", hex: "#e8c9b8", image: "/products/ruwa-kaftan.jpg" },
      { name: "Lilac", hex: "#c5b3d6", image: "/products/ruwa-kaftan-lilac.jpg" },
      { name: "Powder Blue", hex: "#b9c8d6", image: "/products/ruwa-kaftan-blue.jpg" },
    ],
    sizes: ["S", "M", "L", "XL", "2XL"],
    fabric: "Satin floral with French lace bell sleeves",
    description:
      "The Ruwa gathers light — satin blooms in peach, lilac and powder blue, finished with French lace bell sleeves. A kaftan that dresses up as easily as it lounges.",
    newArrival: true,
    bestSeller: true,
    tone: "#e8c9b8",
    image: "/products/ruwa-kaftan.jpg",
  },
  {
    id: "p4",
    slug: "cardigan-premium",
    name: "Cardigan Premium",
    price: 210,
    category: "women",
    colors: [
      { name: "Stone", hex: "#8e8a85" },
      { name: "Sage", hex: "#a9b39b" },
      { name: "Mauve", hex: "#b98d95" },
    ],
    sizes: ["S", "M", "L", "XL", "2XL"],
    fabric: "Heavyweight ribbed knit",
    description:
      "The everyday layer — a longline premium cardigan in a heavyweight knit that drapes without clinging, from desk to dinner.",
    bestSeller: true,
    tone: "#8e8a85",
  },
  {
    id: "p5",
    slug: "stretchable-rayon-inner",
    name: "Stretchable Rayon Inner",
    price: 50,
    category: "accessories",
    colors: [
      { name: "Noir", hex: "#1f1d20" },
      { name: "Cocoa", hex: "#7a5c4e" },
      { name: "Chestnut", hex: "#5c4033" },
    ],
    sizes: ["Free Size"],
    fabric: "4-way stretch premium rayon",
    description:
      "The essential inner — buttery-soft stretchable rayon with full coverage and a snag-free finish. The one you re-buy in every shade.",
    bestSeller: true,
    tone: "#5c4033",
  },
  {
    id: "p6",
    slug: "maya-satin-shawl",
    name: "Maya Satin Shawl",
    price: 89,
    category: "accessories",
    collection: "maya",
    colors: [
      { name: "Champagne", hex: "#e2cdb2" },
      { name: "Sage", hex: "#a9b39b" },
      { name: "Dusty Rose", hex: "#c99b98" },
    ],
    sizes: ["Free Size"],
    fabric: "Matte satin silk blend",
    description:
      "A matte satin shawl with the perfect weight for shaping — no slip, no shine overload, finished with baby hems.",
    newArrival: true,
    tone: "#e2cdb2",
  },
  {
    id: "p7",
    slug: "kurta-rifqi",
    name: "Kurta Rifqi",
    price: 180,
    category: "men",
    colors: [
      { name: "Forest", hex: "#3b4636" },
      { name: "Ivory", hex: "#efe9dd" },
      { name: "Navy", hex: "#383c61" },
    ],
    sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
    fabric: "Cotton-linen blend",
    description:
      "A modern kurta in breathable cotton-linen — band collar, concealed placket, tailored through the shoulder with room to move.",
    bestSeller: true,
    tone: "#3b4636",
  },
  {
    id: "p8",
    slug: "baju-melayu-teluk-belanga",
    name: "Baju Melayu Teluk Belanga",
    price: 260,
    category: "men",
    collection: "raya",
    colors: [
      { name: "Navy", hex: "#383c61" },
      { name: "Emerald", hex: "#2f5d50" },
      { name: "Sand", hex: "#cbb89d" },
    ],
    sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
    fabric: "Premium cotton silk",
    description:
      "Raya-ready Baju Melayu in premium cotton silk — Teluk Belanga neckline, matching trousers, unshakeable structure through the day.",
    newArrival: true,
    tone: "#383c61",
  },
  {
    id: "p9",
    slug: "raya-kurung-seri",
    name: "Kurung Seri",
    price: 320,
    category: "women",
    collection: "raya",
    colors: [
      { name: "Pearl", hex: "#e8e2d6" },
      { name: "Sage", hex: "#a9b39b" },
      { name: "Dusty Blue", hex: "#8d99b5" },
    ],
    sizes: ["XS", "S", "M", "L", "XL", "2XL"],
    fabric: "Songket-inspired jacquard",
    description:
      "The Raya centrepiece — a modern kurung in songket-inspired jacquard with a soft metallic thread, cut long and graceful.",
    newArrival: true,
    tone: "#8d99b5",
  },
  {
    id: "p10",
    slug: "luna-palazzo",
    name: "Luna Palazzo",
    price: 150,
    category: "women",
    collection: "luna",
    colors: [
      { name: "Noir", hex: "#1f1d20" },
      { name: "Stone", hex: "#8e8a85" },
    ],
    sizes: ["S", "M", "L", "XL"],
    fabric: "Heavy crepe, high waist",
    description:
      "Wide-leg palazzo in heavy crepe — opaque, uncrushable, with a comfort waistband that holds its line through travel days.",
    tone: "#1f1d20",
  },
];

export type NavItem = {
  label: string;
  to: string;
  children?: { label: string; to: string }[];
};

export const NAV: NavItem[] = [
  {
    label: "Women",
    to: "/collections/women",
    children: [
      { label: "Abaya & Dresses", to: "/collections/women" },
      { label: "Kurung & Sets", to: "/collections/raya" },
      { label: "Outerwear", to: "/collections/women" },
      { label: "Bottoms", to: "/collections/women" },
      { label: "Inners & Essentials", to: "/collections/accessories" },
    ],
  },
  {
    label: "Men",
    to: "/collections/men",
    children: [
      { label: "Kurta", to: "/collections/men" },
      { label: "Baju Melayu", to: "/collections/men" },
      { label: "Accessories", to: "/collections/accessories" },
    ],
  },
  {
    label: "Signature",
    to: "/collections/signature",
    children: [
      { label: "Maya Collection", to: "/collections/maya" },
      { label: "Amanda Collection", to: "/collections/amanda" },
      { label: "Luna Series", to: "/collections/luna" },
    ],
  },
  { label: "Collections", to: "/collections/new-arrivals" },
  { label: "Accessories", to: "/collections/accessories" },
  { label: "Fabrics", to: "/pages/fabrics" },
  { label: "Raya Collection", to: "/collections/raya" },
  { label: "About Kalima", to: "/pages/about-kalima" },
];

export const ANNOUNCEMENTS = [
  "FREE SHIPPING for orders above RM300",
  "New: The Maya Collection — luxury chiffon, effortless elegance",
  "Join Kalima Club for exclusive offers & private sales",
];

export const HERO_SLIDES = [
  {
    eyebrow: "New Collection",
    title: "Timeless Modest Luxury",
    body: "Designed in Malaysia for every beautiful journey.",
    primary: { label: "Shop Collection", to: "/collections/new-arrivals" },
    secondary: { label: "New Arrivals", to: "/collections/new-arrivals" },
    image: "/products/maya-chiffon.jpg",
    /* Seated pose, empty backdrop above — crop in so the face sits upper-middle */
    focal: "center 38%",
  },
  {
    eyebrow: "The Maya Collection",
    title: "Luxury Chiffon, Effortless Elegance",
    body: "Crafted with premium fabric, finished by hand.",
    primary: { label: "Discover Maya", to: "/collections/maya" },
    secondary: { label: "Shop Women", to: "/collections/women" },
    image: "/products/sofea-dress.jpg",
    focal: "center 30%",
  },
  {
    eyebrow: "Raya Collection",
    title: "For Every Beautiful Homecoming",
    body: "Kurung, kebaya and Baju Melayu for the whole family.",
    primary: { label: "Shop Raya", to: "/collections/raya" },
    secondary: { label: "Shop Men", to: "/collections/men" },
    image: "/products/bella-dress.jpg",
    /* Standing pose, subject already high in frame */
    focal: "center 14%",
  },
];

export const USPS = [
  { icon: "flag", title: "Made in Malaysia", body: "Proudly local, globally loved." },
  { icon: "fabric", title: "Premium Fabrics", body: "In-house fabric for the finest quality." },
  { icon: "scissors", title: "In-house Design", body: "Thoughtfully designed for every detail." },
  { icon: "sizes", title: "Inclusive Sizing", body: "Multiple sizes for every woman." },
  { icon: "leaf", title: "Sustainable Fashion", body: "Responsible choices for a better tomorrow." },
] as const;

export type CollectionMeta = {
  slug: string;
  title: string;
  description: string;
  filter: (p: Product) => boolean;
};

export const COLLECTIONS: CollectionMeta[] = [
  { slug: "women", title: "Women", description: "Abaya, kurung, dresses and modest essentials.", filter: (p) => p.category === "women" },
  { slug: "men", title: "Men", description: "Kurta, Baju Melayu and refined staples.", filter: (p) => p.category === "men" },
  { slug: "accessories", title: "Accessories", description: "Shawls, inners and finishing touches.", filter: (p) => p.category === "accessories" },
  { slug: "best-sellers", title: "Best Sellers", description: "The pieces our community loves most.", filter: (p) => !!p.bestSeller },
  { slug: "new-arrivals", title: "New Arrivals", description: "Fresh from the Kalima atelier.", filter: (p) => !!p.newArrival },
  { slug: "maya", title: "Maya Collection", description: "Luxury chiffon. Effortless elegance. Crafted with premium fabric.", filter: (p) => p.collection === "maya" },
  { slug: "amanda", title: "Amanda Collection", description: "Soft shimmer for celebration days.", filter: (p) => p.collection === "amanda" },
  { slug: "luna", title: "Luna Series", description: "Evening silhouettes with quiet drama.", filter: (p) => p.collection === "luna" },
  { slug: "raya", title: "Raya Collection", description: "For every beautiful homecoming.", filter: (p) => p.collection === "raya" },
  { slug: "signature", title: "Signature", description: "Maya, Amanda and Luna — the Kalima signatures.", filter: (p) => !!p.collection && p.collection !== "raya" },
];

// --- Data access (async; same signatures the Supabase layer will use) ---

export async function fetchProducts(): Promise<Product[]> {
  return PRODUCTS;
}

export async function fetchProductBySlug(slug: string): Promise<Product | undefined> {
  return PRODUCTS.find((p) => p.slug === slug);
}

export async function fetchCollection(slug: string): Promise<{ meta: CollectionMeta; products: Product[] } | undefined> {
  const meta = COLLECTIONS.find((c) => c.slug === slug);
  if (!meta) return undefined;
  return { meta, products: PRODUCTS.filter(meta.filter) };
}
