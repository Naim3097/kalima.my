import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/server";
import { productPhoto } from "@/lib/images";

/*
  The homepage's editorial photography — the three category tiles and the
  collection spotlight.

  These were hardcoded: each component built its URL from a slug and a colourway
  through productPhoto(), so replacing a photograph meant a deploy. Now each one
  is a SLOT that the CMS can override with an upload plus framing, and the
  hardcoded pick is the fallback rather than the only answer.

  A missing row is not an error — it is "nobody has changed this one", which is
  the state every slot starts in and most stay in. So the defaults below are
  live code, not seed data waiting to be replaced: they render today, they
  render on a fresh clone with no Supabase at all, and they render if the read
  fails. Only an actual upload takes over.

  Framing (`focal` + `zoom`) works exactly as it does for hero slides: the frame
  is fixed-aspect, so the photo is placed by object-position and scaled about
  that same point to crop in. The upload itself is never cut.
*/

export type EditorialSlot =
  | "category-women"
  | "category-men"
  | "category-accessories"
  | "spotlight";

export type EditorialImage = {
  image: string;
  /** CSS object-position — where the photo sits in its frame. */
  focal: string;
  /** Scale about `focal`. 1 = the whole photo, higher crops in. */
  zoom: number;
  alt: string;
};

/*
  The shot each slot shows until someone changes it, with the framing the
  components used inline before this existed — so switching them over to this
  module is a no-op on screen.
*/
export const EDITORIAL_DEFAULTS: Record<EditorialSlot, EditorialImage> = {
  "category-women": {
    image: productPhoto("ruwa-caftan", "mocha"),
    focal: "center 20%",
    zoom: 1,
    alt: "Women",
  },
  "category-men": {
    image: productPhoto("kurta-zaid", "navy"),
    focal: "center 20%",
    zoom: 1,
    alt: "Men",
  },
  "category-accessories": {
    image: productPhoto("italian-chiffon-shawl", "latte"),
    focal: "center 20%",
    zoom: 1,
    alt: "Accessories",
  },
  spotlight: {
    image: productPhoto("serra-scallop", "burgundy"),
    focal: "center top",
    zoom: 1,
    alt: "Serra Scallop cardigan abaya in burgundy",
  },
};

export const EDITORIAL_SLOTS = Object.keys(EDITORIAL_DEFAULTS) as EditorialSlot[];

/** Human labels for the back office. Kept here so the slot list has one home. */
export const EDITORIAL_SLOT_LABELS: Record<EditorialSlot, string> = {
  "category-women": "Category tile · Women",
  "category-men": "Category tile · Men",
  "category-accessories": "Category tile · Accessories",
  spotlight: "Collection spotlight",
};

const isSlot = (value: string): value is EditorialSlot =>
  Object.hasOwn(EDITORIAL_DEFAULTS, value);

/*
  Every slot, defaults merged with whatever the CMS overrides. Always returns a
  complete map, so callers index it without a null check.

  Session-less (public) client: this is the same photography for every visitor,
  and reading cookies here would opt the whole homepage out of static rendering.
*/
export const getEditorialImages = cache(
  async (): Promise<Record<EditorialSlot, EditorialImage>> => {
    const resolved = { ...EDITORIAL_DEFAULTS };

    const supabase = createPublicClient();
    if (!supabase) return resolved;

    const { data, error } = await supabase
      .from("editorial_images")
      .select("slot, image, focal, zoom, alt");
    // A failed read falls back to the hardcoded shots rather than an empty page.
    if (error || !data) return resolved;

    for (const row of data) {
      // A slot retired in code but still in the table is skipped, not crashed on.
      if (!isSlot(row.slot) || !row.image) continue;
      resolved[row.slot] = {
        image: row.image,
        focal: row.focal || EDITORIAL_DEFAULTS[row.slot].focal,
        zoom: row.zoom ?? 1,
        alt: row.alt || EDITORIAL_DEFAULTS[row.slot].alt,
      };
    }

    return resolved;
  },
);
