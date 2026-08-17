/*
  Product photography lives in the Supabase Storage bucket `product-images`,
  one file per colourway at <slug>/<colour>.jpg. Catalogue pages get their URLs
  from product_images rows; the editorial sections on the homepage pick a
  specific shot by hand, and use this to build the URL.
*/
/*
  NEXT_PUBLIC_LEGACY_IMAGE_HOST wins when set, and that is the whole point.

  Catalogue pages read product_images.url, so their photos follow the data. These
  editorial picks are different: the slug/colour pairs below are written into the
  components by hand, so the URL is BUILT rather than read — and building it from
  NEXT_PUBLIC_SUPABASE_URL points it at whichever project the environment uses.

  On staging that is staging's own bucket, which is empty: its catalogue is copied
  from production, not its storage. Every hand-picked shot 404'd (the homepage
  category tiles and the collection spotlight) while catalogue photos loaded fine
  — the confusing half-broken split next.config.ts already allows both hosts for.
  Unset in production, where the derived host is the only correct one.

  Known limitation, and why it is acceptable: re-uploading one of these shots on
  staging will not show there, because this keeps pointing at production. These
  are fixed editorial choices, not content anyone edits per environment.
*/
const HOST = process.env.NEXT_PUBLIC_LEGACY_IMAGE_HOST
  ? `https://${process.env.NEXT_PUBLIC_LEGACY_IMAGE_HOST}`
  : process.env.NEXT_PUBLIC_SUPABASE_URL;

const BASE = `${HOST}/storage/v1/object/public/product-images`;

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
