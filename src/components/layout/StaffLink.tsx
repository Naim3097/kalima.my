"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";

/*
  Renders its children only for signed-in staff.

  Exists because the Footer is a Server Component inside the statically
  rendered storefront shell. Reading the session there would opt every page out
  of static rendering — the exact tradeoff useAuth was written to avoid — so the
  staff check happens in the browser instead.

  UX ONLY. This hides a convenience link; it is not a guard. Anyone can type
  /admin, and what actually stops them is the role check in proxy.ts, re-checked
  in the admin layout. Never gate anything security-relevant on this.
*/
export default function StaffLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { isStaff, ready } = useAuth();
  // Render nothing until the check resolves, so the link never flashes for a
  // customer mid-hydration.
  if (!ready || !isStaff) return null;
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
