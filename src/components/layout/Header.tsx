import Link from "next/link";
import { NAV } from "@/data/catalog";
import { ChevronDownIcon } from "@/components/brand/Icons";
import HeaderActions from "./HeaderActions";
import NavLink from "./NavLink";

/*
  Server Component. The wordmark and the whole nav tree (including the hover
  mega-menus, which are pure CSS) render as static HTML — no JS. Only the
  utility row's counters and buttons are a client island.
*/
export default function Header() {
  return (
    <header className="sticky top-0 z-40 bg-cream/95 backdrop-blur border-b border-navy/10">
      {/* Utility row */}
      <div className="mx-auto grid max-w-7xl grid-cols-3 items-center px-4 py-4 lg:py-5">
        <HeaderActions side="left" />

        <Link href="/" className="justify-self-center text-center" aria-label="Kalima home">
          <span className="block font-display text-[26px] lg:text-[32px] tracking-[0.35em] pl-[0.35em] text-navy">
            KALIMA
          </span>
          <span className="mt-0.5 block text-[8px] lg:text-[9px] uppercase tracking-[0.52em] pl-[0.52em] text-navy-400">
            Timeless Modest Luxury
          </span>
        </Link>

        <HeaderActions side="right" />
      </div>

      {/* Primary nav (desktop) */}
      <nav className="hidden lg:block border-t border-navy/5">
        <ul className="mx-auto flex max-w-7xl items-center justify-center gap-9 px-4">
          {NAV.map((item) => (
            <li key={item.label} className="group relative">
              <NavLink href={item.to}>
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
                            href={child.to}
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
