import { Link, NavLink } from "react-router-dom";
import { NAV } from "../../data/catalog";
import { useCart, cartCount } from "../../stores/cart";
import { useWishlist } from "../../stores/wishlist";
import { useUi } from "../../stores/ui";
import {
  SearchIcon,
  PinIcon,
  UserIcon,
  HeartIcon,
  BagIcon,
  ChevronDownIcon,
  MenuIcon,
} from "../ui/Icons";

export default function Header() {
  const items = useCart((s) => s.items);
  const wishlistCount = useWishlist((s) => s.ids.length);
  const { setCartOpen, setSearchOpen, setMobileMenuOpen } = useUi();
  const bagCount = cartCount(items);

  return (
    <header className="sticky top-0 z-40 bg-cream/95 backdrop-blur border-b border-navy/10">
      {/* Utility row */}
      <div className="mx-auto grid max-w-7xl grid-cols-3 items-center px-4 py-4 lg:py-5">
        <div className="flex items-center gap-5">
          <button
            className="lg:hidden text-navy cursor-pointer"
            aria-label="Open menu"
            onClick={() => setMobileMenuOpen(true)}
          >
            <MenuIcon size={20} />
          </button>
          <button
            onClick={() => setSearchOpen(true)}
            className="hidden lg:inline-flex items-center gap-2 label-caps text-navy-400 hover:text-navy transition-colors cursor-pointer"
          >
            <SearchIcon size={16} /> Search
          </button>
          <Link
            to="/pages/stores"
            className="hidden lg:inline-flex items-center gap-2 label-caps text-navy-400 hover:text-navy transition-colors"
          >
            <PinIcon size={16} /> Stores
          </Link>
        </div>

        <Link to="/" className="justify-self-center text-center" aria-label="Kalima home">
          <span className="block font-display text-[26px] lg:text-[32px] tracking-[0.35em] pl-[0.35em] text-navy">
            KALIMA
          </span>
          <span className="mt-0.5 block text-[8px] lg:text-[9px] uppercase tracking-[0.52em] pl-[0.52em] text-navy-400">
            Timeless Modest Luxury
          </span>
        </Link>

        <div className="flex items-center justify-end gap-5">
          <button
            onClick={() => setSearchOpen(true)}
            className="lg:hidden text-navy cursor-pointer"
            aria-label="Search"
          >
            <SearchIcon size={19} />
          </button>
          <Link
            to="/account"
            className="hidden lg:inline-flex items-center gap-2 label-caps text-navy-400 hover:text-navy transition-colors"
          >
            <UserIcon size={16} /> Account
          </Link>
          <Link
            to="/wishlist"
            className="relative inline-flex items-center gap-2 label-caps text-navy-400 hover:text-navy transition-colors"
            aria-label={`Wishlist (${wishlistCount})`}
          >
            <HeartIcon size={17} />
            <span className="hidden lg:inline">Wishlist</span>
            {wishlistCount > 0 && (
              <span className="absolute -right-2.5 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-navy text-[9px] text-white">
                {wishlistCount}
              </span>
            )}
          </Link>
          <button
            onClick={() => setCartOpen(true)}
            className="inline-flex items-center gap-2 label-caps text-navy-400 hover:text-navy transition-colors cursor-pointer"
            aria-label={`Bag (${bagCount})`}
          >
            <BagIcon size={17} />
            <span className="hidden lg:inline">Bag ({bagCount})</span>
          </button>
        </div>
      </div>

      {/* Primary nav (desktop) */}
      <nav className="hidden lg:block border-t border-navy/5">
        <ul className="mx-auto flex max-w-7xl items-center justify-center gap-9 px-4">
          {NAV.map((item) => (
            <li key={item.label} className="group relative">
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  `label-caps inline-flex items-center gap-1.5 py-3.5 transition-colors ${
                    isActive ? "text-navy" : "text-navy-400 hover:text-navy"
                  }`
                }
              >
                {item.label}
                {item.children && <ChevronDownIcon size={12} />}
              </NavLink>

              {item.children && (
                <div className="invisible absolute left-1/2 top-full z-50 -translate-x-1/2 pt-0 opacity-0 transition-all duration-150 group-hover:visible group-hover:opacity-100">
                  <div className="min-w-56 border border-navy/10 bg-cream-50 px-7 py-6 shadow-lg">
                    <ul className="space-y-3.5">
                      {item.children.map((child) => (
                        <li key={child.label}>
                          <Link
                            to={child.to}
                            className="block text-[13px] tracking-wide text-navy-400 hover:text-navy transition-colors whitespace-nowrap"
                          >
                            {child.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
