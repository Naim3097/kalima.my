import AnnouncementBar from "@/components/layout/AnnouncementBar";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import Overlays from "@/components/layout/Overlays";

/*
  Storefront shell. Server Component — the header's nav tree and the footer
  render to static HTML; only the announcement rotator, the header's
  cart/wishlist counters and the overlays ship JS.
*/
export default function StorefrontLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <AnnouncementBar />
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
      <Overlays />
    </div>
  );
}
