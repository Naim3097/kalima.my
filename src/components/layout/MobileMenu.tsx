"use client";

import { useState } from "react";
import Link from "next/link";
import { NAV } from "@/data/catalog";
import { useUi } from "@/stores/ui";
import { ChevronDownIcon, CloseIcon } from "@/components/brand/Icons";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";

/*
  Mobile navigation drawer on the shadcn Sheet (left side). The primitive owns
  the backdrop, Escape, focus trap, body scroll lock and slide animation.
*/
export default function MobileMenu() {
  const { isStaff } = useAuth();
  const { mobileMenuOpen, setMobileMenuOpen } = useUi();
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
      <SheetContent
        side="left"
        showCloseButton={false}
        aria-describedby={undefined}
        className="w-full max-w-xs gap-0 overflow-y-auto border-r-0 bg-cream-50 p-0 shadow-2xl sm:max-w-xs"
      >
        <div className="flex items-center justify-between border-b border-navy/10 px-6 py-5">
          <SheetTitle className="font-display font-normal tracking-[0.3em] text-navy">
            KALIMA
          </SheetTitle>
          <SheetClose aria-label="Close menu" className="text-navy-400 cursor-pointer">
            <CloseIcon size={18} />
          </SheetClose>
        </div>
        <nav className="px-6 py-4">
          <ul className="divide-y divide-navy/5">
            {NAV.map((item) => (
              <li key={item.label} className="py-1">
                <div className="flex items-center justify-between">
                  <Link
                    href={item.to}
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
                          href={child.to}
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
              { label: "My Account", href: "/account" },
              { label: "Wishlist", href: "/wishlist" },
              { label: "Stores", href: "/pages/stores" },
              // Back Office is appended below, only for staff.
            ].map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="block py-2 text-[13px] tracking-wide text-navy-400"
                >
                  {l.label}
                </Link>
              </li>
            ))}
            {/* Staff only. MobileMenu is already a client component, so it can
                read the hook directly — no island needed here. */}
            {isStaff && (
              <li>
                <Link
                  href="/admin"
                  onClick={() => setMobileMenuOpen(false)}
                  className="block py-2 text-[13px] tracking-wide text-navy-400"
                >
                  Back Office
                </Link>
              </li>
            )}
          </ul>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
