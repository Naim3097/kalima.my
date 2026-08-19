import { GoogleTagManager } from "@next/third-parties/google";
import AnnouncementBar from "@/components/layout/AnnouncementBar";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import Overlays from "@/components/layout/Overlays";
import SignupPromo from "@/components/layout/SignupPromo";
import { getCurrentUser } from "@/lib/auth";
import { getAnnouncements, getSignupPromo } from "@/lib/cms";

/*
  Storefront shell. Server Component — the header's nav tree and the footer
  render to static HTML; only the announcement rotator, the header's
  cart/wishlist counters and the overlays ship JS.

  Announcement copy is CMS-managed: fetched here via the session-less public
  client (so pages stay statically renderable) and passed to the rotator.

  The sign-up popup is decided HERE rather than in the component: a member never
  downloads a modal asking them to become one. Reading the session makes this
  layout dynamic, which is the price of not showing "join us" to someone who
  already did — and it only applies when the promotion is switched on, since an
  off promo returns null before the session is ever read.

  GOOGLE TAG MANAGER LIVES HERE, NOT IN THE ROOT LAYOUT. This shell wraps every
  customer-facing route including the whole checkout funnel, so the coverage is
  the same "every page of your website" the GTM instructions ask for — but the
  back office is outside it. A tag manager can be given tags that read page
  content or record sessions, and /admin renders order emails, phone numbers and
  delivery addresses. Keeping it out is also what stops staff pageviews from
  being counted as shoppers.
*/

/* The container. A public identifier — it appears in the page source of every
   site that uses it — so it is written here rather than kept as a secret it is
   not. */
const GTM_ID = "GTM-MT6TFF39";

/*
  PREVIEW DEPLOYMENTS DO NOT REPORT. staging.kalima.my runs the same code, and
  every rehearsal, Playwright run and browser check done against it would
  otherwise land in the shop's analytics as real shopper behaviour — quietly
  wrong numbers being worse than none. VERCEL_ENV is set by the platform, so
  this needs no configuration and cannot be forgotten. Locally it is undefined,
  which also means no tag fires during development.
*/
const TRACKING_ON = process.env.VERCEL_ENV === "production";
export default async function StorefrontLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [announcements, promo] = await Promise.all([getAnnouncements(), getSignupPromo()]);

  /* Only asked when there is something to show — see the note above. */
  const current = promo ? await getCurrentUser() : null;
  const showPromo = promo && !current;

  return (
    <div className="flex min-h-screen flex-col">
      {TRACKING_ON && (
        <>
          <GoogleTagManager gtmId={GTM_ID} />
          {/*
            The no-JavaScript half of GTM's snippet, which <GoogleTagManager />
            does not render — it only emits the two scripts. Without this a
            visitor with JS disabled is invisible to the container. It sits at
            the top of the shell rather than immediately after <body> because
            <body> belongs to the root layout, which deliberately has no tag on
            it; an iframe's position in the body does not affect whether it
            loads.
          */}
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
              height="0"
              width="0"
              style={{ display: "none", visibility: "hidden" }}
            />
          </noscript>
        </>
      )}
      <AnnouncementBar messages={announcements} />
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
      <Overlays />
      {showPromo && <SignupPromo promo={promo} />}
    </div>
  );
}
