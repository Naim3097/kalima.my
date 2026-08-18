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
*/
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
      <AnnouncementBar messages={announcements} />
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
      <Overlays />
      {showPromo && <SignupPromo promo={promo} />}
    </div>
  );
}
