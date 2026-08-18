import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getContactChannels, getContentPage, listContentPageSlugs } from "@/lib/cms";

const PAGES: Record<string, { title: string; body: string[] }> = {
  "about-kalima": {
    title: "About Kalima",
    body: [
      "Kalima is a Malaysian modest fashion house built on a simple belief: elegance and modesty belong together, without compromise.",
      "Every piece is designed in-house in Malaysia, cut from premium fabrics we source and test ourselves, and made to travel with you through every beautiful journey — from everyday moments to the celebrations that matter.",
    ],
  },
  fabrics: {
    title: "Our Fabrics",
    body: [
      "We build each collection around fabric first — luxury chiffon with true drape, breathable cotton-linen, heavyweight crepe that holds its line, and 4-way stretch rayon for all-day ease.",
      "Full fabric stories and care guides are being prepared for this page.",
    ],
  },
  stores: {
    title: "Stores",
    body: [
      "Our store locator is coming soon. Meanwhile, shop online with free shipping for orders above RM300 nationwide.",
    ],
  },
  /* Body deliberately empty — the previous copy was removed and nothing has
     replaced it yet. The DB row wins when present, so this is only what a
     fresh clone or an unconfigured Supabase renders. */
  shipping: {
    title: "Shipping",
    body: [],
  },
  returns: {
    title: "Returns & Exchanges",
    body: [
      "We offer a 14-day easy return policy from the day your order arrives. Items must be unworn with tags intact.",
      "The full self-service returns portal is on its way.",
    ],
  },
  /*
    Kept in step with the seeded content_pages row in the product_addons
    migration. The DB row wins when present; this is what renders on a fresh
    clone or an unconfigured Supabase.

    The Instagram handle and WhatsApp number are deliberately absent from the
    prose — they render below as buttons from store_settings, so there is one
    place to change them.
  */
  "custom-sizing": {
    title: "Custom Sizing",
    body: [
      "Looking for a tailored fit? We offer custom sizing on request — just DM us on Instagram or WhatsApp us with your measurements and preferred style, and we'll confirm fabric and style availability.",
      "Please note: custom orders take up to 2–3 weeks and are not eligible for exchange.",
    ],
  },
  "size-guide": {
    title: "Size Guide",
    body: ["Detailed measurement charts for every silhouette are being prepared. For now, our team is happy to help you size correctly — contact us."],
  },
  contact: {
    title: "Contact Us",
    body: ["Customer support channels (WhatsApp, email, social) will be listed here. We're here to help."],
  },
  "kalima-club": {
    title: "Kalima Club",
    body: [
      "Kalima Club is our loyalty membership — earn points on every purchase, unlock tiers, and enjoy exclusive offers and private sales.",
      "Launching soon. Join the newsletter to be first in line.",
    ],
  },
  /*
    Required by Meta before the WhatsApp app can leave Development mode, and by
    PDPA 2010 s.7 regardless — a data user must give notice of what it collects
    and why. Written against what the schema actually stores rather than a
    template, so the two cannot drift apart: every claim below is checkable in
    supabase/migrations.

    Reachable while MAINTENANCE_MODE is on (see OPEN_DURING_MAINTENANCE in
    src/lib/maintenance.ts) because Meta fetches the URL to validate it and a
    503 reads as invalid.

    Lives here rather than in content_pages because it must survive an empty
    database — Meta re-checks this URL periodically, and a policy that vanishes
    with a bad deploy takes the WhatsApp channel down with it. Seed a
    content_pages row later if staff need to edit it without a deploy; the DB
    wins over this map when present.
  */
  privacy: {
    title: "Privacy Policy",
    body: [
      "Last updated 5 August 2026. This policy explains how KALIMA GROUP TRADING (M) SDN. BHD. (Company No. 202101012868 / 1413167-V), trading as Kalima, collects and handles your personal data. We are the data user under Malaysia's Personal Data Protection Act 2010 (PDPA), and this notice is given under section 7 of that Act.",

      "What we collect. When you create an account we hold your name, email address, phone number and whether you have consented to marketing. When you place an order we hold your delivery recipient name, phone number and full address, the items ordered and the amount paid. If you join Kalima Club we hold your points balance and tier. If you subscribe to our newsletter we hold your email address, your name if given, and a record of when and where you gave consent. We do not ask for your identity card number, date of birth, or any other information we have no use for.",

      "Payments. Payments are processed by our gateway, LeanX, using FPX online banking and e-wallets. You enter your banking or wallet credentials on your own bank's or provider's page, never on ours. We receive and store only the transaction reference, the amount and whether the payment succeeded. Kalima never sees, holds or stores your card number, online banking password, PIN or TAC.",

      "Delivery. To send you an order we pass your recipient name, phone number and delivery address to our courier partners through EasyParcel. They use it to deliver your parcel and to give you tracking updates, and for nothing else on our instruction.",

      "Messaging. If you message us on WhatsApp, Instagram or Facebook, we store that conversation — the message content, the time it was sent, and the phone number or handle it came from — so our team can answer you and see your order history alongside your question. These conversations reach us through Meta Platforms, whose own terms and privacy policy govern the message while it is in transit. We reply to you; we do not use these conversations to build advertising profiles.",

      "Marketing. We only send marketing email or WhatsApp messages if you have opted in, and every marketing email carries a working unsubscribe link that is unique to you. Withdrawing consent is free and takes effect immediately. Transactional messages about an order you have actually placed — payment received, parcel shipped, tracking number — are not marketing and will still be sent, because you need them.",

      "Cookies and tracking. We use cookies that are necessary for the site to work: keeping you signed in, remembering your cart, and carrying the security token that protects forms from cross-site abuse. Our affiliate programme records that a referral link was clicked, storing only a one-way hash and never your IP address or browser fingerprint — we count clicks, we do not identify visitors. We do not run third-party advertising or cross-site tracking cookies.",

      "Who we share it with. Your data is processed on our behalf by Supabase (database and authentication, hosted in Singapore), Vercel (website hosting), LeanX (payments), EasyParcel (delivery), Resend (transactional email) and Meta Platforms (WhatsApp, Instagram and Facebook messaging). Each receives only what it needs to do its job. We do not sell your personal data, and we do not share it with anyone for their own marketing. We will disclose data where the law requires it or to establish or defend a legal claim.",

      "Transfers outside Malaysia. Some of these providers process data on servers outside Malaysia. Where that happens we rely on the provider's contractual data protection commitments to keep your data protected to a standard comparable to the PDPA.",

      "How long we keep it. Order, payment and delivery records are kept for seven years, because Malaysian tax and company law requires us to. Account details are kept while your account is open. Newsletter records are kept until you unsubscribe, after which we keep a minimal suppression record so we do not accidentally email you again. Customer service conversations are kept for two years.",

      "Your rights. Under the PDPA you may ask us for a copy of the personal data we hold about you, ask us to correct anything inaccurate, ask us to stop using it for marketing, or ask us to delete it where we are not legally required to keep it. Write to hello@kalima.my and we will respond within twenty-one days. If you are not satisfied, you may complain to the Personal Data Protection Commissioner, Malaysia.",

      "Security. Access to customer data is restricted to Kalima staff who need it, enforced at the database level rather than only in the application. Traffic to this site is encrypted in transit. No system is perfectly secure, but we do not store payment credentials at all, which removes the most damaging thing an attacker could take.",

      "Children. This site is not intended for children under 18, and we do not knowingly collect their personal data. If you believe a child has given us data, contact us and we will delete it.",

      "Changes. If we change this policy we will update the date at the top of this page. Material changes affecting how we use data you have already given us will be notified to you directly.",

      "Contact. KALIMA GROUP TRADING (M) SDN. BHD., No. 26-1, Jalan Eco Grandeur 1/8A, Eco Grandeur, Bandar Puncak Alam, 42300 Selangor, Malaysia. Email hello@kalima.my.",
    ],
  },
};

type Props = { params: Promise<{ slug: string }> };

export const revalidate = 3600;

/*
  Pages are CMS-managed (src/lib/cms.ts). The hardcoded PAGES map above is the
  fallback for an unconfigured Supabase (fresh clone) — the DB wins when present.
*/
async function resolvePage(slug: string): Promise<{ title: string; body: string[] } | null> {
  const fromCms = await getContentPage(slug);
  if (fromCms) return { title: fromCms.title, body: fromCms.body };
  return PAGES[slug] ?? null;
}

export async function generateStaticParams() {
  const slugs = await listContentPageSlugs();
  return (slugs.length ? slugs : Object.keys(PAGES)).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = await resolvePage(slug);
  if (!page) return { title: "Page not found" };
  return { title: page.title, description: page.body[0] };
}

export default async function ContentPage({ params }: Props) {
  const { slug } = await params;
  const page = await resolvePage(slug);

  if (!page) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <nav className="label-caps mb-8 text-navy-300">
        <Link href="/" className="hover:text-navy transition-colors">
          Home
        </Link>{" "}
        / <span className="text-navy-400">{page.title}</span>
      </nav>
      <h1 className="font-display text-4xl text-navy">{page.title}</h1>
      <div className="mt-8 space-y-5">
        {page.body.map((para, i) => (
          <p key={i} className="text-[15px] leading-relaxed tracking-wide text-navy-400">
            {para}
          </p>
        ))}
      </div>
      {slug === "custom-sizing" && <CustomSizingContacts />}
    </div>
  );
}

/*
  The "DM us" buttons under the custom-sizing copy.

  Scoped to this one page rather than every content page: it is the only one
  whose entire purpose is to start a conversation. Each button is omitted when
  its channel is unconfigured, so an empty store_settings shows prose alone
  rather than links that go nowhere.
*/
async function CustomSizingContacts() {
  const { instagram, whatsapp } = await getContactChannels();
  if (!instagram && !whatsapp) return null;

  return (
    <div className="mt-10 flex flex-wrap gap-3">
      {instagram && (
        <a
          href={instagram.href}
          target="_blank"
          rel="noopener noreferrer"
          className="label-caps border border-navy px-6 py-3 text-[11px] text-navy transition-colors hover:bg-navy hover:text-white"
        >
          DM us on Instagram {instagram.handle}
        </a>
      )}
      {whatsapp && (
        <a
          href={whatsapp.href}
          target="_blank"
          rel="noopener noreferrer"
          className="label-caps border border-navy bg-navy px-6 py-3 text-[11px] text-white transition-colors hover:bg-navy-700"
        >
          WhatsApp {whatsapp.display}
        </a>
      )}
    </div>
  );
}
