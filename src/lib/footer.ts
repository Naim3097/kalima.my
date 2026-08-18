import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/server";

/*
  The footer's content, from the CMS.

  Everything here used to be constants in the component, so adding a page meant
  a deploy. Now it is data — but data of three different shapes, because the
  footer is three different things: shop-wide TEXT (company, tagline), the trust
  STRIP, and NAVIGATION.

  The constants survive as DEFAULTS rather than being deleted. A fresh clone
  with no Supabase, and a failed read on a live shop, both still render a
  complete footer instead of a bare navy band — and the seed in the
  editable_footer migration was taken from these exact values, so the two agree.
*/

/* Re-exported for server callers; a Client Component must import the registry
   from @/lib/trust-icons directly, since this module is server-only. */
export { TRUST_ICON_KEYS, TRUST_ICONS, trustIcon, type TrustIconKey } from "@/lib/trust-icons";

export type TrustItem = { icon: string; title: string; body: string | null };
export type FooterLink = { label: string; href: string };
export type FooterColumn = { heading: string; items: FooterLink[] };

export type FooterContent = {
  companyName: string | null;
  companyRegNo: string | null;
  tagline: string;
  paymentNote: string | null;
  trust: TrustItem[];
  columns: FooterColumn[];
};

/* ---- Defaults ------------------------------------------------------------ */

export const FOOTER_DEFAULTS: FooterContent = {
  companyName: "KALIMA GROUP TRADING (M) SDN. BHD.",
  companyRegNo: "202101012868 (1413167-V)",
  tagline: "Timeless modest luxury — designed in Malaysia for every beautiful journey.",
  paymentNote: "FPX · Visa · Mastercard · GrabPay — secure checkout",
  trust: [
    { icon: "truck", title: "Worldwide Delivery", body: "Rates shown at checkout" },
    { icon: "return", title: "Easy Returns", body: "14 days return policy" },
    { icon: "shield", title: "Secure Payment", body: "100% secure checkout" },
    { icon: "headset", title: "Customer Support", body: "We're here to help" },
  ],
  columns: [
    {
      heading: "Shop",
      items: [
        { label: "Women", href: "/collections/women" },
        { label: "Men", href: "/collections/men" },
        { label: "Accessories", href: "/collections/accessories" },
        { label: "New Arrivals", href: "/collections/new-arrivals" },
        { label: "Best Sellers", href: "/collections/best-sellers" },
      ],
    },
    {
      heading: "Help",
      items: [
        { label: "Shipping", href: "/pages/shipping" },
        { label: "Returns & Exchanges", href: "/pages/returns" },
        { label: "Size Guide", href: "/pages/size-guide" },
        { label: "Custom Sizing", href: "/pages/custom-sizing" },
        { label: "Contact Us", href: "/pages/contact" },
        // Meta checks that the Privacy Policy URL it was given is actually
        // reachable from the site, not just a bare URL typed into a form.
        { label: "Privacy Policy", href: "/pages/privacy" },
      ],
    },
    {
      heading: "Kalima",
      items: [
        { label: "About Kalima", href: "/pages/about-kalima" },
        { label: "Our Fabrics", href: "/pages/fabrics" },
        { label: "Stores", href: "/pages/stores" },
        /* /kalima-club is the live programme; /pages/kalima-club is a CMS page
           still saying "launching soon". Point people at the working one. */
        { label: "Kalima Club", href: "/kalima-club" },
        { label: "Refer a Friend", href: "/affiliate" },
        /* The only account link that does not depend on the header's role
           logic — shoppers expect one at the bottom of the page, and staff
           have no other desktop route to their own account. */
        { label: "My Account", href: "/account" },
      ],
    },
  ],
};

/* ---- Read ---------------------------------------------------------------- */

/*
  One footer, assembled from three reads.

  Each PART falls back independently: an empty link table does not cost the shop
  its trust strip, and unreadable settings do not cost it its navigation. The
  footer is on every page, so partial content beats an exception.
*/
export const getFooterContent = cache(async (): Promise<FooterContent> => {
  const supabase = createPublicClient();
  if (!supabase) return FOOTER_DEFAULTS;

  const [settings, trust, columns] = await Promise.all([
    supabase
      .from("store_settings")
      .select("company_name, company_reg_no, footer_tagline, footer_payment_note")
      .eq("id", 1)
      .maybeSingle(),
    supabase
      .from("footer_trust")
      .select("icon, title, body")
      .eq("active", true)
      .order("sort_order"),
    supabase
      .from("footer_link_columns")
      .select("heading, sort_order, footer_links ( label, href, sort_order, active )")
      .order("sort_order"),
  ]);

  const s = settings.data;

  type RawColumn = {
    heading: string;
    footer_links: { label: string; href: string; sort_order: number; active: boolean }[] | null;
  };

  const rawColumns = (columns.data ?? []) as unknown as RawColumn[];
  const mapped: FooterColumn[] = rawColumns
    .map((col) => ({
      heading: col.heading,
      items: (col.footer_links ?? [])
        .filter((l) => l.active)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((l) => ({ label: l.label, href: l.href })),
    }))
    // A column with nothing in it is a heading over empty space.
    .filter((col) => col.items.length > 0);

  return {
    companyName: s?.company_name ?? FOOTER_DEFAULTS.companyName,
    companyRegNo: s?.company_reg_no ?? FOOTER_DEFAULTS.companyRegNo,
    tagline: s?.footer_tagline || FOOTER_DEFAULTS.tagline,
    paymentNote: s?.footer_payment_note ?? FOOTER_DEFAULTS.paymentNote,
    trust: trust.data?.length ? trust.data : FOOTER_DEFAULTS.trust,
    columns: mapped.length ? mapped : FOOTER_DEFAULTS.columns,
  };
});
