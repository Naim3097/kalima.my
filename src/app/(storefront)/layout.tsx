import AnnouncementBar from "@/components/layout/AnnouncementBar";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import Overlays from "@/components/layout/Overlays";
import { getAnnouncements } from "@/lib/cms";

/*
  Storefront shell. Server Component — the header's nav tree and the footer
  render to static HTML; only the announcement rotator, the header's
  cart/wishlist counters and the overlays ship JS.

  Announcement copy is CMS-managed: fetched here via the session-less public
  client (so pages stay statically renderable) and passed to the rotator.
*/
export default async function StorefrontLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const announcements = await getAnnouncements();

  return (
    <div className="flex min-h-screen flex-col">
      <AnnouncementBar messages={announcements} />
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
      <Overlays />
    </div>
  );
}
