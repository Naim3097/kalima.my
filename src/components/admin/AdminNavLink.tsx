"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/*
  Replaces react-router's <NavLink> inside the back-office shell. Same pattern
  as src/components/layout/NavLink.tsx: a tiny client island, because active
  state needs the current pathname which a Server Component cannot read.

  `exact` mirrors react-router's `end` — /admin must not light up on
  /admin/orders.
*/
export default function AdminNavLink({
  href,
  exact = false,
  className,
  activeClassName,
  inactiveClassName,
  children,
}: {
  href: string;
  exact?: boolean;
  className?: string;
  activeClassName?: string;
  inactiveClassName?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={cn(className, isActive ? activeClassName : inactiveClassName)}
    >
      {children}
    </Link>
  );
}
