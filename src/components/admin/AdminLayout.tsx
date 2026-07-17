import { NavLink, Outlet, Link } from "react-router-dom";

const NAV_SECTIONS: { heading: string; items: { label: string; to: string; end?: boolean; badge?: string }[] }[] = [
  {
    heading: "Store",
    items: [
      { label: "Dashboard", to: "/admin", end: true },
      { label: "Orders", to: "/admin/orders" },
      { label: "Products", to: "/admin/products" },
      { label: "Customers", to: "/admin/customers" },
    ],
  },
  {
    heading: "Growth",
    items: [
      { label: "Broadcasts", to: "/admin/campaigns", badge: "①" },
      { label: "Affiliates", to: "/admin/affiliates", badge: "②" },
      { label: "Kalima Club", to: "/admin/loyalty", badge: "③" },
    ],
  },
  {
    heading: "Operations",
    items: [
      { label: "Shipping · EasyParcel", to: "/admin/shipping", badge: "④" },
      { label: "Marketplace Sync", to: "/admin/sync", badge: "⑤" },
      { label: "Unified Inbox", to: "/admin/inbox", badge: "⑥" },
    ],
  },
];

export default function AdminLayout() {
  return (
    <div className="flex min-h-screen bg-cream">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-navy-900 lg:flex">
        <Link to="/" className="flex items-center gap-3 border-b border-white/10 px-6 py-5">
          <img src="/brand/kalima-mark-white.png" alt="Kalima" className="h-9 w-auto" />
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
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        `flex items-center justify-between rounded px-3 py-2 text-[13px] tracking-wide transition-colors ${
                          isActive ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white"
                        }`
                      }
                    >
                      <span>{item.label}</span>
                      {item.badge && <span className="text-[11px] text-white/40">{item.badge}</span>}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 px-6 py-4">
          <Link to="/" className="text-[12px] tracking-wide text-white/50 hover:text-white transition-colors">
            ← View storefront
          </Link>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-h-screen flex-1 flex-col lg:pl-60">
        {/* Mobile nav — the sidebar is desktop-only */}
        <div className="sticky top-0 z-30 bg-navy-900 lg:hidden">
          <div className="flex items-center gap-3 px-4 pt-3">
            <Link to="/" className="flex items-center gap-2">
              <img src="/brand/kalima-mark-white.png" alt="Kalima" className="h-6 w-auto" />
              <span className="text-[9px] uppercase tracking-[0.3em] text-white/50">Back Office</span>
            </Link>
          </div>
          <nav className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 py-3">
            {NAV_SECTIONS.flatMap((s) => s.items).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `shrink-0 rounded-full px-3.5 py-1.5 text-[12px] tracking-wide transition-colors ${
                    isActive ? "bg-white text-navy" : "bg-white/10 text-white/70"
                  }`
                }
              >
                {item.label}
                {item.badge ? ` ${item.badge}` : ""}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="border-b border-amber-300/60 bg-amber-50 px-4 py-2.5 lg:px-6">
          <p className="text-[12px] tracking-wide text-amber-900">
            <span className="font-semibold uppercase tracking-wider">Demo preview</span> — sample data for client
            walkthrough. Numbered modules ①–⑥ are the client's requested features; live integrations arrive in
            Phases 4–9.
          </p>
        </div>
        <main className="flex-1 px-4 py-6 lg:px-6 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
