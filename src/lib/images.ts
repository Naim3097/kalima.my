/*
  Product photography lives in the Supabase Storage bucket `product-images`,
  one file per colourway at <slug>/<colour>.jpg. Catalogue pages get their URLs
  from product_images rows; the editorial sections on the homepage pick a
  specific shot by hand, and use this to build the URL.
*/
const BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images`;

/** e.g. productPhoto("ruwa-caftan", "burgundy") */
export const productPhoto = (slug: string, colour: string) => `${BASE}/${slug}/${colour}.jpg`;
