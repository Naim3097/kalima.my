# Kalima Storefront — kalima.my

Custom e-commerce platform for Kalima (Timeless Modest Luxury). React + Supabase build; currently a
**client-demo release**: the full storefront plus clickable mockups of every planned feature.
Master build reference: [PROJECT_PLAN.md](./PROJECT_PLAN.md).

## Stack

- **React 18 + Vite + TypeScript** — SPA, route-level pages
- **Tailwind CSS v4** — design tokens in [`src/index.css`](src/index.css) (`@theme`)
- **React Router 7** · **TanStack Query 5** · **Zustand 5** (cart/wishlist/UI, persisted)
- **Supabase** (`@supabase/supabase-js`) — client wired in [`src/lib/supabase.ts`](src/lib/supabase.ts), inactive until env vars are set

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle
```

Copy `.env.example` → `.env` and fill in Supabase credentials when the project exists (Phase 2).

## Structure

```
src/
  index.css            # Brand tokens: Kalima Navy #383C61 scale, cream/beige, type
  data/catalog.ts      # Seed catalog + nav + hero slides (swaps to Supabase queries, same signatures)
  data/demo.ts         # Sample datasets for the demo admin/account/affiliate screens
  lib/supabase.ts      # Supabase client (null until env configured)
  stores/              # Zustand: cart (free-shipping threshold), wishlist, UI drawers
  hooks/useCatalog.ts  # TanStack Query wrappers over the data layer
  components/
    ui/                # Button, ProductCard, ProductImage (photo→placeholder fallback), icons
    layout/            # Header, nav, cart drawer, search overlay, mobile menu, footer
    home/              # Hero carousel, category tiles, spotlight, best sellers, USP, lookbook
    admin/             # AdminLayout (sidebar + mobile nav) + admin UI primitives
  pages/               # Storefront pages + /admin pages (demo previews of Phases 3–9)
public/
  brand/               # Logo assets (navy + white)
  products/            # Photoshoot imagery (per-colour variants supported via catalog)
```

## Integration points (per phase)

| Integration | Where it plugs in | Phase |
|---|---|---|
| Supabase (auth, catalog, orders) | `src/lib/supabase.ts` + swap `src/data/catalog.ts` fetchers | 2 |
| Payment gateway (FPX/card/e-wallet) | `src/pages/CheckoutPage.tsx` — webhook-confirmed via Edge Function | 2 |
| EasyParcel (rates, AWB, tracking) | Checkout shipping step + `src/pages/admin/AdminShipping.tsx` | 4 |
| WhatsApp Cloud API / Resend | `src/pages/admin/AdminCampaigns.tsx` | 5 |
| Affiliate engine | `/affiliate` portal + `src/pages/admin/AdminAffiliates.tsx` | 6 |
| Loyalty ledger ("Kalima Club") | `/account` + `src/pages/admin/AdminLoyalty.tsx` | 7 |
| Shopee / TikTok Shop sync | `src/pages/admin/AdminSync.tsx` | 8 |
| Unified inbox | `src/pages/admin/AdminInbox.tsx` | 9 |

All demo screens read from `src/data/demo.ts` and carry a "Demo preview" badge — replace data sources,
keep the UIs.

## Conventions

- **Money**: MYR via `formatRM()` (`src/lib/format.ts`)
- **Imagery**: everything flows through `ProductImage` — photo if the catalog has one, branded
  placeholder gradient otherwise. Per-colour photos: set `image` on a `ColorOption`.
- **Brand**: navy `#383C61` as ink on warm cream surfaces; serif display (Playfair) + tracked-caps
  sans (Jost). See PROJECT_PLAN.md §2.
