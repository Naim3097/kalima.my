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
    primary: { label: s.primary.label, href: s.primary.to },
    secondary: { label: s.secondary.label, href: s.secondary.to },
  }));
}
