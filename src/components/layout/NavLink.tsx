"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/*
  Replaces react-router's <NavLink>. Tiny client island: active state needs
  the current pathname, which is not available to a Server Component.
*/
export default function NavLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "label-caps inline-flex items-center gap-1.5 py-3.5 transition-colors",
        isActive ? "text-navy" : "text-navy-400 hover:text-navy",
        className,
      )}
    >
      {children}
    </Link>
  );
}
