import "server-only";

import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/server";
import { ANNOUNCEMENTS, HERO_SLIDES } from "@/data/catalog";

/*
  CMS data access for the storefront. Public content, so it reads through the
  session-less public client — pages stay statically renderable (ISR), same as
  the catalog. Falls back to the hardcoded seed when Supabase is unconfigured,
  so a fresh clone still renders.

  Admin CMS reads/writes go through src/lib/admin.ts + the server actions
  (staff-gated), not this module.
*/

export type HeroSlide = {
  eyebrow: string | null;
  title: string;
  body: string | null;
  image: string;
  focal: string;
  /* Scales the image around `focal`, cropping into the frame. 1 = untouched. */
  zoom: number;
  primary: { label: string; href: string } | null;
  secondary: { label: string; href: string } | null;
};

export type ContentPage = { slug: string; title: string; body: string[] };

/** Announcement bar messages, in order. */
export const getAnnouncements = cache(async (): Promise<string[]> => {
  const supabase = createPublicClient();
  if (!supabase) return [...ANNOUNCEMENTS];

  const { data, error } = await supabase
    .from("announcements")
    .select("text")
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error || !data?.length) return [...ANNOUNCEMENTS];
  return data.map((a) => a.text);
});

/** Hero carousel slides, in order. */
export const getHeroSlides = cache(async (): Promise<HeroSlide[]> => {
  const supabase = createPublicClient();
  if (!supabase) return seedHero();

  const { data, error } = await supabase
    .from("hero_slides")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error || !data?.length) return seedHero();

  return data.map((s) => ({
    eyebrow: s.eyebrow,
    title: s.title,
    body: s.body,
    image: s.image,
    focal: s.focal ?? "center",
    zoom: s.zoom ?? 1,
    primary: s.primary_label ? { label: s.primary_label, href: s.primary_href ?? "#" } : null,
    secondary: s.secondary_label ? { label: s.secondary_label, href: s.secondary_href ?? "#" } : null,
  }));
});

/** A single content page by slug, or null. */
export const getContentPage = cache(async (slug: string): Promise<ContentPage | null> => {
  const supabase = createPublicClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("content_pages")
    .select("slug, title, body")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();

  if (error || !data) return null;
  return { slug: data.slug, title: data.title, body: (data.body as string[]) ?? [] };
});

/** All published page slugs, for generateStaticParams. */
export async function listContentPageSlugs(): Promise<string[]> {
  const supabase = createPublicClient();
  if (!supabase) return [];
  const { data } = await supabase.from("content_pages").select("slug").eq("published", true);
  return (data ?? []).map((p) => p.slug);
}

export type SocialLink = { platform: "instagram" | "tiktok" | "facebook" | "threads"; href: string };

/*
  The shop's social profiles, in the order they are shown.

  Read through the public client because store_settings is public-readable and
  the footer renders on every page — going via the admin client would drag the
  service-role key into a layout. Anything unset is simply absent from the
  list, so the row shrinks to whatever the shop actually has rather than
  showing a dead icon.
*/
export const getSocialLinks = cache(async (): Promise<SocialLink[]> => {
  const supabase = createPublicClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("store_settings")
    .select("social_instagram, social_tiktok, social_facebook, social_threads")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) return [];

  const order: SocialLink["platform"][] = ["instagram", "tiktok", "facebook", "threads"];
  const byPlatform: Record<SocialLink["platform"], string | null> = {
    instagram: data.social_instagram,
    tiktok: data.social_tiktok,
    facebook: data.social_facebook,
    threads: data.social_threads,
  };

  return order
    .filter((platform) => Boolean(byPlatform[platform]))
    .map((platform) => ({ platform, href: byPlatform[platform] as string }));
});

/*
  One homepage Lookbook tile, already resolved to something renderable.

  The component gets a URL and a hex, never a slug-and-colour it has to turn into
  a path — that convention (`<slug>/<colour>.jpg`) is what let the old hardcoded
  list drift away from the catalogue and keep pointing at a colourway Anna Top no
  longer sells.
*/
export type LookbookShot = {
  /** Product slug — every tile links to its product page. */
  slug: string;
  image: string;
  /** Swatch hex for the blur placeholder (see blurSeed in lib/images.ts). */
  tone: string;
  alt: string;
};

/* The five shots that used to be hardcoded in the component, kept as the
   unconfigured-Supabase fallback exactly like seedHero below. */
const SEED_LOOKBOOK: LookbookShot[] = [
  { slug: "ruwa-caftan", tone: "#8d2d33", image: "/lookbook/ruwa-caftan.jpg", alt: "Ruwa Caftan in burgundy satin" },
  { slug: "danisya-set", tone: "#be1a84", image: "/lookbook/danisya-set.jpg", alt: "Danisya Set in magenta satin" },
  { slug: "serra-scallop", tone: "#126c82", image: "/lookbook/serra-scallop.jpg", alt: "Serra Scallop cardigan abaya in teal green" },
  { slug: "anna-top", tone: "#c08b93", image: "/lookbook/anna-top.jpg", alt: "Anna Top in the Dusty Lily print" },
  { slug: "luna-palazzo", tone: "#c8bcb0", image: "/lookbook/luna-palazzo.jpg", alt: "Luna Palazo in sand" },
];

/*
  The sign-up popup's content, or null when it is switched off.

  Null rather than an `enabled` flag on the way out, so the layout renders
  nothing at all when the promotion is off — no component, no client bundle, no
  timer — instead of shipping a modal that has decided to stay closed.

  `perks` is stored as a jsonb array of plain strings and rendered as a list;
  anything that is not a string is dropped rather than coerced, because the one
  thing this must not do is put an editor's input into the page as markup.
*/
export type SignupPromo = {
  eyebrow: string | null;
  heading: string;
  body: string | null;
  perks: string[];
  ctaLabel: string;
  ctaHref: string;
  delaySeconds: number;
  dismissDays: number;
};

export const getSignupPromo = cache(async (): Promise<SignupPromo | null> => {
  const supabase = createPublicClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("signup_promo")
    .select("enabled, eyebrow, heading, body, perks, cta_label, cta_href, delay_seconds, dismiss_days")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data || !data.enabled) return null;

  return {
    eyebrow: data.eyebrow,
    heading: data.heading,
    body: data.body,
    perks: Array.isArray(data.perks) ? data.perks.filter((p): p is string => typeof p === "string") : [],
    ctaLabel: data.cta_label,
    ctaHref: data.cta_href,
    delaySeconds: data.delay_seconds,
    dismissDays: data.dismiss_days,
  };
});

/*
  The new-member discount, in SEN, or 0 when the shop is not running one.

  Read separately from getSignupPromo() because the two are independent: the
  popup is advertising and this is money. create_order applies the same value
  from the same row — this read exists only so the checkout can show a shopper
  what they are about to be given.
*/
export const getFirstOrderDiscountSen = cache(async (): Promise<number> => {
  const supabase = createPublicClient();
  if (!supabase) return 0;

  const { data, error } = await supabase
    .from("signup_promo")
    .select("first_order_discount_sen")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) return 0;
  return data.first_order_discount_sen ?? 0;
});

/*
  What the shop charges for delivery, in RINGGIT for display.

  The same two columns create_order reads, so the checkout summary and the
  written order cannot disagree — they used to be constants in the form, which
  is exactly how a quote and a charge drift apart. `freeShippingAbove` of 0
  means no free shipping; see the free_shipping_threshold_off_at_zero migration.

  Falls back to the column defaults rather than throwing: a checkout that will
  not render because a settings row is unreadable is worse than one quoting the
  standard rate.
*/
export const getShippingPricing = cache(
  async (): Promise<{ flatRm: number; freeShippingAbove: number }> => {
    const fallback = { flatRm: 10, freeShippingAbove: 0 };

    const supabase = createPublicClient();
    if (!supabase) return fallback;

    /* Through shop_public_settings(), not the table: store_settings is closed
       to the public client because it holds the EasyParcel tokens, so a select
       here read nothing and quietly returned the fallback below. */
    const { data, error } = await supabase.rpc("shop_public_settings");
    if (error || !data) return fallback;

    const s = data as { flat_shipping_sen?: number; free_shipping_threshold_sen?: number };
    return {
      flatRm: (s.flat_shipping_sen ?? 1000) / 100,
      freeShippingAbove: (s.free_shipping_threshold_sen ?? 0) / 100,
    };
  },
);

/*
  Instagram posts for the homepage strip, newest first.

  The image is OUR mirrored copy, never Instagram's CDN — see
  src/lib/instagram/sync.ts for why that is not an optimisation but a
  correctness requirement.

  `slug` is present only when staff have tagged the post with a product; that is
  what decides whether a tile opens a product page or the post on Instagram.
  RLS hides `hidden` rows from the public, so nothing here re-filters them.

  An empty array is the normal state before the first sync, and the caller falls
  back to the curated Lookbook rather than rendering a gap.
*/
export type InstagramPost = {
  id: string;
  image: string;
  permalink: string;
  alt: string;
  slug: string | null;
  /* Reels and video posts show a still; the badge is what stops that still
     reading as a photograph. */
  video: boolean;
};

export const getInstagramPosts = cache(async (): Promise<InstagramPost[]> => {
  const supabase = createPublicClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("instagram_posts")
    .select("id, image, permalink, caption, media_type, products ( slug )")
    .order("posted_at", { ascending: false })
    .limit(20);

  if (error || !data?.length) return [];

  type Row = {
    id: string;
    image: string;
    permalink: string;
    caption: string | null;
    media_type: string;
    products: { slug: string } | { slug: string }[] | null;
  };

  return (data as unknown as Row[]).map((row) => {
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    return {
      id: row.id,
      image: row.image,
      permalink: row.permalink,
      /* The caption is the only description Instagram gives us. First line
         only, and trimmed — captions run to paragraphs and hashtag walls, none
         of which is useful read aloud. */
      alt: row.caption?.split("\n")[0]?.slice(0, 120).trim() || "Kalima on Instagram",
      slug: product?.slug ?? null,
      video: row.media_type === "VIDEO",
    };
  });
});

/*
  Homepage Lookbook tiles, in order.

  Each row names a product and one of ITS colourways; the photograph is resolved
  here from the real product_images row rather than rebuilt from a path. So a
  shot cannot reference a colour that does not exist, and replacing a colour's
  photo updates the Lookbook with nothing else to do.

  RLS already restricts rows to published products, so nothing here re-checks
  that — see the "lookbook shots follow their product" policy.
*/
export const getLookbookShots = cache(async (): Promise<LookbookShot[]> => {
  const supabase = createPublicClient();
  if (!supabase) return SEED_LOOKBOOK;

  const { data, error } = await supabase
    .from("lookbook_shots")
    .select(
      `color_name, alt,
       products!inner (
         slug, name, tone,
         product_images ( url, color_name, position ),
         product_variants ( color_name, color_hex )
       )`,
    )
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error || !data?.length) return SEED_LOOKBOOK;

  type Row = {
    color_name: string;
    alt: string | null;
    products: {
      slug: string;
      name: string;
      tone: string;
      product_images: { url: string; color_name: string | null; position: number }[];
      product_variants: { color_name: string; color_hex: string | null }[];
    } | null;
  };

  const shots: LookbookShot[] = [];

  for (const row of data as unknown as Row[]) {
    const p = row.products;
    if (!p) continue;

    const forColour = p.product_images
      .filter((i) => i.color_name === row.color_name)
      .sort((a, b) => a.position - b.position)[0];

    /*
      Fall back to the product's colour-less hero shot, then give up. A tile with
      no photograph is worse than a shorter row — it renders as a hole. The admin
      only offers colourways that HAVE an image, so reaching the give-up branch
      means a photo was deleted after the shot was created.
    */
    const image =
      forColour ??
      p.product_images.filter((i) => !i.color_name).sort((a, b) => a.position - b.position)[0];
    if (!image) continue;

    /* color_hex is genuinely nullable here: Serra Scallop has Burgundy and Mocha
       images with no matching variant, so the product tone is the backstop. */
    const tone =
      p.product_variants.find((v) => v.color_name === row.color_name)?.color_hex || p.tone;

    /*
      DELIBERATELY DOES NOT FALL BACK TO product_images.alt.

      That column is populated from the uploaded filename, so trusting it put
      alt="WhatsApp Image 2026-08-12 at 7.58.47 PM" on a homepage tile — worse
      for a screen reader than saying nothing useful, and invisible to anyone
      looking at the page. "<Product> in <Colour>" is always available and always
      describes the photograph, so it is the floor. Staff who want better can
      write it on the shot itself.
    */
    shots.push({
      slug: p.slug,
      image: image.url,
      tone,
      alt: row.alt?.trim() || `${p.name} in ${row.color_name}`,
    });
  }

  return shots.length ? shots : SEED_LOOKBOOK;
});

export type ContactChannels = {
  /** Profile URL, and the handle derived from it for display. */
  instagram: { href: string; handle: string } | null;
  /** wa.me link built from the configured number. */
  whatsapp: { href: string; display: string } | null;
};

/*
  The two channels the custom-sizing page invites people to use.

  Read from store_settings rather than written into the page copy, so the
  handle and the number live in one editable place. The copy says "DM us on
  Instagram"; these render as the actual buttons underneath it.

  Returns null per channel when unset, and the page simply omits that button —
  a "WhatsApp us" link to wa.me/ with no number is worse than no button.
*/
export const getContactChannels = cache(async (): Promise<ContactChannels> => {
  const supabase = createPublicClient();
  if (!supabase) return { instagram: null, whatsapp: null };

  const { data, error } = await supabase
    .from("store_settings")
    .select("social_instagram, social_whatsapp")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) return { instagram: null, whatsapp: null };

  const igUrl = (data.social_instagram as string | null)?.trim() || null;
  const waRaw = (data.social_whatsapp as string | null)?.trim() || null;

  /*
    The handle is the last non-empty path segment of the profile URL. Parsing
    can fail on a value that is not a URL at all, so fall back to showing
    "Instagram" rather than throwing on the whole page for a cosmetic label.
  */
  let instagram: ContactChannels["instagram"] = null;
  if (igUrl) {
    let handle = "Instagram";
    try {
      const seg = new URL(igUrl).pathname.split("/").filter(Boolean).pop();
      if (seg) handle = `@${seg}`;
    } catch {
      /* not a parseable URL — keep the generic label */
    }
    instagram = { href: igUrl, handle };
  }

  /*
    wa.me accepts digits only — no +, spaces or dashes — so a number typed as
    "+60 12-345 6789" must be stripped before it becomes a link, while the
    human-readable form is what we show.
  */
  let whatsapp: ContactChannels["whatsapp"] = null;
  if (waRaw) {
    const digits = waRaw.replace(/\D/g, "");
    if (digits) whatsapp = { href: `https://wa.me/${digits}`, display: waRaw };
  }

  return { instagram, whatsapp };
});

/** Maps the seed HERO_SLIDES (client shape) to HeroSlide. */
function seedHero(): HeroSlide[] {
  return HERO_SLIDES.map((s) => ({
    eyebrow: s.eyebrow,
    title: s.title,
    body: s.body,
    image: s.image,
    focal: s.focal,
    zoom: 1,
    primary: { label: s.primary.label, href: s.primary.to },
    secondary: { label: s.secondary.label, href: s.secondary.to },
  }));
}
