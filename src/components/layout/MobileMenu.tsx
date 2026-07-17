import { useState } from "react";
import { Link } from "react-router-dom";
import { NAV } from "../../data/catalog";
import { useUi } from "../../stores/ui";
import { ChevronDownIcon, CloseIcon } from "../ui/Icons";

export default function MobileMenu() {
  const { mobileMenuOpen, setMobileMenuOpen } = useUi();
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <>
      <div
        className={`fixed inset-0 z-50 bg-navy-900/40 transition-opacity lg:hidden ${
          mobileMenuOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setMobileMenuOpen(false)}
        aria-hidden
      />
      <aside
        className={`fixed left-0 top-0 z-50 h-full w-full max-w-xs overflow-y-auto bg-cream-50 shadow-2xl transition-transform duration-300 lg:hidden ${
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Menu"
      >
        <div className="flex items-center justify-between border-b border-navy/10 px-6 py-5">
          <span className="font-display tracking-[0.3em] text-navy">KALIMA</span>
          <button onClick={() => setMobileMenuOpen(false)} aria-label="Close menu" className="text-navy-400 cursor-pointer">
            <CloseIcon size={18} />
          </button>
        </div>
        <nav className="px-6 py-4">
          <ul className="divide-y divide-navy/5">
            {NAV.map((item) => (
              <li key={item.label} className="py-1">
                <div className="flex items-center justify-between">
                  <Link
                    to={item.to}
                    onClick={() => setMobileMenuOpen(false)}
                    className="label-caps block py-3 text-navy"
                  >
                    {item.label}
                  </Link>
                  {item.children && (
                    <button
                      aria-label={`Expand ${item.label}`}
                      onClick={() => setExpanded(expanded === item.label ? null : item.label)}
                      className={`p-2 text-navy-400 transition-transform cursor-pointer ${
                        expanded === item.label ? "rotate-180" : ""
                      }`}
                    >
                      <ChevronDownIcon size={14} />
                    </button>
                  )}
                </div>
                {item.children && expanded === item.label && (
                  <ul className="mb-3 space-y-2 pl-3">
                    {item.children.map((child) => (
                      <li key={child.label}>
                        <Link
                          to={child.to}
                          onClick={() => setMobileMenuOpen(false)}
                          className="block py-1 text-[13px] tracking-wide text-navy-400"
                        >
                          {child.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          {/* Utility links — mirrors the desktop header extras */}
          <ul className="mt-2 border-t border-navy/10 pt-4 space-y-1">
            {[
              { label: "My Account", to: "/account" },
              { label: "Wishlist", to: "/wishlist" },
              { label: "Stores", to: "/pages/stores" },
              { label: "Back Office (demo)", to: "/admin" },
            ].map((l) => (
              <li key={l.to}>
                <Link
                  to={l.to}
                  onClick={() => setMobileMenuOpen(false)}
                  className="block py-2 text-[13px] tracking-wide text-navy-400"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    </>
  );
}
