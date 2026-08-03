"use client";

import Link from "next/link";
import { useCart, cartCount } from "@/stores/cart";
import { useWishlist } from "@/stores/wishlist";
import { useUi } from "@/stores/ui";
import { useMounted } from "@/hooks/useMounted";
import { useAuth } from "@/hooks/useAuth";
import {
  SearchIcon,
  PinIcon,
  UserIcon,
  HeartIcon,
  BagIcon,
  MenuIcon,
} from "@/components/brand/Icons";

/*
  The interactive half of the header. Split out of Header.tsx so the nav tree
  and wordmark stay server-rendered.
*/
export default function HeaderActions({ side }: { side: "left" | "right" }) {
  const items = useCart((s) => s.items);
  const wishlistIds = useWishlist((s) => s.ids);
  const { setCartOpen, setSearchOpen, setMobileMenuOpen } = useUi();
  const { signedIn, isStaff, ready: authReady } = useAuth();

  // Persisted stores are empty during SSR; hold the empty state until mount.
  const mounted = useMounted();
  const bagCount = mounted ? cartCount(items) : 0;
  const wishlistCount = mounted ? wishlistIds.length : 0;

  if (side === "left") {
    return (
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
          href="/pages/stores"
          className="hidden lg:inline-flex items-center gap-2 label-caps text-navy-400 hover:text-navy transition-colors"
        >
          <PinIcon size={16} /> Stores
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-5">
      <button
        onClick={() => setSearchOpen(true)}
        className="lg:hidden text-navy cursor-pointer"
        aria-label="Search"
      >
        <SearchIcon size={19} />
      </button>
      {/*
        Staff get the back office where a customer gets their account: it is
        where they actually work. /account still exists for them — the owner
        places test orders and needs to see them as a customer does — this only
        changes the default door. UX only; the guard is server-side.
      */}
      <Link
        href={
          !authReady || signedIn === false ? "/login" : isStaff ? "/admin" : "/account"
        }
        className="hidden lg:inline-flex items-center gap-2 label-caps text-navy-400 hover:text-navy transition-colors"
      >
        <UserIcon size={16} />{" "}
        {authReady && !signedIn ? "Sign in" : isStaff ? "Back office" : "Account"}
      </Link>
      <Link
        href="/wishlist"
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
  );
}
