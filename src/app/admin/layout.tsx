import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import AdminNavLink from "@/components/admin/AdminNavLink";
import { DemoPreviewBanner } from "@/components/admin/ui";
import { getCurrentUser, isStaff } from "@/lib/auth";

/*
  Back-office shell. Server Component — the sidebar, the mobile nav strip and
  the demo banner are static markup; only the per-link active state is a
  client island (AdminNavLink), exactly as the storefront header does it.

  The navy surface comes from the --sidebar-* tokens in globals.css
  (bg-navy-900 / white text), unchanged from the pre-port design.

  Access: the proxy already gates /admin on a staff/admin role. This is the
  defence-in-depth re-check — a layout should never assume the edge did its
  job. Only enforced when Supabase is configured; the seed-data demo (no auth)
  stays open, as before.
*/

const NAV_SECTIONS: { heading: string; items: { label: string; to: string; end?: boolean; badge?: string }[] }[] = [
  {
    heading: "Store",
    items: [
      { label: "Dashboard", to: "/admin", end: true },
      { label: "Orders", to: "/admin/orders" },
      { label: "Products", to: "/admin/products" },
      { label: "Customers", to: "/admin/customers" },
      { label: "Discounts", to: "/admin/discounts" },
      { label: "Content", to: "/admin/cms" },
    ],
  },
  {
    heading: "Growth",
    items: [
      { label: "Broadcasts", to: "/admin/campaigns" },
      { label: "Affiliates", to: "/admin/affiliates", badge: "②" },
      { label: "Kalima Club", to: "/admin/loyalty", badge: "③" },
    ],
  },
  {
    heading: "Operations",
    items: [
      { label: "Shipping", to: "/admin/shipping" },
      { label: "Marketplace Sync", to: "/admin/sync", badge: "⑤" },
      { label: "Unified Inbox", to: "/admin/inbox", badge: "⑥" },
    ],
  },
  {
    heading: "Configure",
    items: [
      { label: "Settings", to: "/admin/settings" },
      { label: "Staff & Roles", to: "/admin/staff" },
      { label: "Audit Log", to: "/admin/audit" },
    ],
  },
];

export const metadata: Metadata = {
  description: "Kalima back office — demo preview.",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Gate only when auth is live. Unconfigured Supabase → open demo (unchanged).
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const current = await getCurrentUser();
    if (!current) redirect("/login?next=/admin");
    if (!isStaff(current.role)) redirect("/");
  }

  return (
    <div className="flex min-h-screen bg-cream print:block print:min-h-0 print:bg-white">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-navy-900 lg:flex print:hidden">
        <Link href="/" className="flex items-center gap-3 border-b border-white/10 px-6 py-5">
          <Image src="/brand/kalima-mark-white.png" alt="Kalima" width={36} height={36} className="h-9 w-auto" />
          <div>
            <p className="font-display tracking-[0.25em] text-white text-sm">KALIMA</p>
            <p className="text-[9px] uppercase tracking-[0.3em] text-white/50">Back Office</p>
          </div>
        </Link>
        <nav className="flex-1 overflow-y-auto px-3 py-5">
          {NAV_SECTIONS.map((section) => (
            <div key={section.heading} className="mb-6">
              <p className="label-caps px-3 pb-2 !text-[9px] text-white/40">{section.heading}</p>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.to}>
                    <AdminNavLink
                      href={item.to}
                      exact={item.end}
                      className="flex items-center justify-between rounded px-3 py-2 text-[13px] tracking-wide transition-colors"
                      activeClassName="bg-white/10 text-white"
                      inactiveClassName="text-white/60 hover:bg-white/5 hover:text-white"
                    >
                      <span>{item.label}</span>
                      {item.badge && <span className="text-[11px] text-white/40">{item.badge}</span>}
                    </AdminNavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 px-6 py-4">
          <Link href="/" className="text-[12px] tracking-wide text-white/50 hover:text-white transition-colors">
            ← View storefront
          </Link>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-h-screen flex-1 flex-col lg:pl-60 print:pl-0">
        {/* Mobile nav — the sidebar is desktop-only */}
        <div className="sticky top-0 z-30 bg-navy-900 lg:hidden print:hidden">
          <div className="flex items-center gap-3 px-4 pt-3">
            <Link href="/" className="flex items-center gap-2">
              <Image src="/brand/kalima-mark-white.png" alt="Kalima" width={24} height={24} className="h-6 w-auto" />
              <span className="text-[9px] uppercase tracking-[0.3em] text-white/50">Back Office</span>
            </Link>
          </div>
          <nav className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 py-3">
            {NAV_SECTIONS.flatMap((s) => s.items).map((item) => (
              <AdminNavLink
                key={item.to}
                href={item.to}
                exact={item.end}
                className="shrink-0 rounded-full px-3.5 py-1.5 text-[12px] tracking-wide transition-colors"
                activeClassName="bg-white text-navy"
                inactiveClassName="bg-white/10 text-white/70"
              >
                {item.label}
                {item.badge ? ` ${item.badge}` : ""}
              </AdminNavLink>
            ))}
          </nav>
        </div>

        <DemoPreviewBanner />

        <main className="flex-1 px-4 py-6 lg:px-6 lg:py-8 print:p-0">{children}</main>
      </div>
    </div>
  );
}
