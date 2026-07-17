import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import AnnouncementBar from "./AnnouncementBar";
import Header from "./Header";
import Footer from "./Footer";
import CartDrawer from "./CartDrawer";
import SearchOverlay from "./SearchOverlay";
import MobileMenu from "./MobileMenu";

export default function Layout() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col">
      <AnnouncementBar />
      <Header />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <CartDrawer />
      <SearchOverlay />
      <MobileMenu />
    </div>
  );
}
