/*
  Product photography lives in the Supabase Storage bucket `product-images`,
  one file per colourway at <slug>/<colour>.jpg. Catalogue pages get their URLs
  from product_images rows; the editorial sections on the homepage pick a
  specific shot by hand, and use this to build the URL.
*/
const BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images`;

/** e.g. productPhoto("ruwa-caftan", "burgundy") */
export const productPhoto = (slug: string, colour: string) => `${BASE}/${slug}/${colour}.jpg`;

/*
  A 4×5 solid-colour seed for next/image's blur placeholder, tinted to the
  garment. next/image blurs and scales it to fill the frame, so what a shopper
  sees while the photo arrives is a soft wash of the colour they are about to
  see — not an empty box that then pops.

  Deliberately not a downscaled copy of the real photo (the usual LQIP): those
  have to be generated, stored and kept in step with the image. The swatch hex
  already exists for every colourway and is close enough at this blur radius,
  since nothing of the shape survives a 4×5 upscale anyway.
*/
export function blurSeed(tone: string): string {
  const hex = tone.replace("#", "");
  const full =
    hex.length === 3
      ? hex.split("").map((c) => c + c).join("")
      : hex.padEnd(6, "0").slice(0, 6);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="5"><rect width="4" height="5" fill="#${full}"/></svg>`;
  /*
    URI-encoded rather than base64: this runs inside Client Components too, and
    base64 has no isomorphic encoder — `Buffer` is Node-only and `btoa` is
    browser-only, so either choice renders on the server and then throws on
    hydration. Encoding needs neither.
  */
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
