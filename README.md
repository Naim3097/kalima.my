# Kalima Storefront — kalima.my

Custom e-commerce platform for Kalima (Timeless Modest Luxury). Next.js + Supabase build; currently a
**client-demo release**: the full storefront plus clickable mockups of every planned feature.
Master build reference: [PROJECT_PLAN.md](./PROJECT_PLAN.md).

## Stack

- **Next.js 16 (App Router) + React 19 + TypeScript** — Server Components by default, client islands where needed
- **Tailwind CSS v4** — design tokens in [`src/app/globals.css`](src/app/globals.css) (`@theme`)
- **shadcn/ui** — Radix primitives in [`src/components/ui/`](src/components/ui), restyled to the Kalima palette
- **Supabase** — Postgres + Auth + Storage via [`src/lib/supabase/`](src/lib/supabase); the catalog is live, auth/orders land in Phase 2
- **TanStack Query 5** · **Zustand 5** (cart/wishlist/UI, persisted)

Requires **Node 22+**. See [`.nvmrc`](./.nvmrc).

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm run typecheck  # tsc --noEmit
```

Copy `.env.example` → `.env.local` and fill in Supabase credentials — see
[`supabase/README.md`](./supabase/README.md) for provisioning.

## Structure

```
src/
  app/
    layout.tsx           # Root: next/font (Playfair + Jost), providers, toaster
    providers.tsx        # TanStack Query client boundary
    globals.css          # Brand tokens: Kalima Navy #383C61 scale, cream/beige, type
    (storefront)/        # Storefront route group — shared header/footer/overlays shell
    admin/               # Back office (demo previews of Phases 3–9)
    api/                 # Route handlers: products, collections, admin resources
  components/
    ui/                  # shadcn primitives (lowercase filenames)
    brand/               # Bespoke editorial: ProductCard, ProductImage, icons, placeholders
    layout/              # Header (server) + HeaderActions (client), nav, overlays, footer
    home/                # Hero carousel, category tiles, spotlight, best sellers, USP, lookbook
    admin/               # Admin shell + back-office widgets
  data/catalog.ts        # Types, seed fallback, nav + hero slides (client-safe)
  data/catalog.queries.ts# Supabase-backed catalog fetchers (server-only)
  data/demo.ts           # Sample datasets for the demo admin/account/affiliate screens
  lib/supabase/          # Browser, public (session-less), server + admin clients
  lib/format.ts          # formatRM()
  lib/utils.ts           # cn()
  stores/                # Zustand: cart (free-shipping threshold), wishlist, UI drawers
  proxy.ts               # Supabase session refresh
supabase/
  migrations/            # Schema, RLS
  seed.sql               # GENERATED from src/data/catalog.ts — npm run seed:generate
scripts/generate-seed.mts
public/
  brand/                 # Logo assets (navy + white)
  products/              # Photoshoot imagery (per-colour variants supported via catalog)
```

## Rendering & lazy loading

RSC-first: pages are Server Components and only interactive leaves ship JavaScript.

| Technique | Where |
|---|---|
| Server Components | All pages; header nav tree, footer, product grids, admin tables |
| Client islands | `HeaderActions`, `ProductCard` swatches, `ProductDetail`, `CheckoutForm`, sort controls |
| `next/dynamic` | Cart drawer, search overlay, mobile menu (`Overlays.tsx`); admin sales chart, inbox panes, sync log |
| `next/image` | Everything via `brand/ProductImage` — AVIF/WebP, responsive srcset, tone-tinted blur placeholder |
| `priority` | First hero slide only (the LCP element) |
| `generateStaticParams` | Product, collection and content routes prerender at build time |
| ISR | Catalog routes revalidate hourly (`export const revalidate = 3600`) |

Persisted Zustand stores (cart, wishlist) read through `useMounted()` so the server's empty
state matches the first client render — see [`src/hooks/useMounted.ts`](src/hooks/useMounted.ts).

## Data flow

The catalog is served from **Supabase** (see [`supabase/README.md`](./supabase/README.md)).

```
src/data/catalog.ts          types · seed fallback · CMS content (client-safe)
src/data/catalog.queries.ts  Supabase queries — "server-only", never client-importable
src/app/api/*                route handlers, for client-side consumers
src/hooks/useCatalog.ts      client hooks; call the API routes, never the query module
```

- **Server Components** import `catalog.queries.ts` directly — a server fetching its own
  HTTP route is a wasted round trip.
- **Client Components** use `useCatalog.ts`, which goes through `/api/*`. The query module
  is marked `server-only`, so importing it from a client component is a build error rather
  than a leaked secret.
- Public catalog reads use `createPublicClient()` (anon, session-less) so pages stay
  statically renderable. Reading cookies would opt every product page out of static
  rendering; anything user-specific must use `createClient()` and accept dynamic rendering.
- If Supabase is **unconfigured**, the fetchers fall back to the seed catalog so a fresh
  clone still runs. If it is configured but a query fails, they **throw** — serving stale
  seed prices while the database is unreachable would be worse than an error.

Shape mapping: the database stores **sen** (`price_sen: 29500` → `price: 295`) and the
colour × size **variant matrix**, which `mapProduct()` collapses back into the catalog's
`colors[]` / `sizes[]` shape using `color_position` / `position`.

## Integration points (per phase)

| Integration | Where it plugs in | Phase |
|---|---|---|
| Supabase catalog | ✅ live — `src/data/catalog.queries.ts` | 2 |
| Supabase auth + orders | `src/lib/supabase/` + Phase 2 schema | 2 |
| Payment gateway (FPX/card/e-wallet) | `src/app/(storefront)/checkout/` — webhook-confirmed via route handler | 2 |
| EasyParcel (rates, AWB, tracking) | Checkout shipping step + `src/app/admin/shipping/` | 4 |
| WhatsApp Cloud API / Resend | `src/app/admin/campaigns/` | 5 |
| Affiliate engine | `/affiliate` portal + `src/app/admin/affiliates/` | 6 |
| Loyalty ledger ("Kalima Club") | `/account` + `src/app/admin/loyalty/` | 7 |
| Shopee / TikTok Shop sync | `src/app/admin/sync/` | 8 |
| Unified inbox | `src/app/admin/inbox/` | 9 |

All demo screens read from `src/data/demo.ts` and carry a "Demo preview" badge — replace data sources,
keep the UIs.

## Conventions

- **Imports** use the `@/` alias → `src/`
- **Server by default**: add `"use client"` only for state, effects, event handlers or stores,
  and push the boundary as far down the tree as possible
- **Money**: MYR via `formatRM()` (`src/lib/format.ts`); the database stores **sen as integers**
- **Imagery**: everything flows through `ProductImage` — photo if the catalog has one, branded
  placeholder gradient otherwise. Per-colour photos: set `image` on a `ColorOption`.
- **Components**: shadcn primitives for anything interactive or tabular; bespoke markup for the
  editorial blocks (hero, product card, spotlight, USP strip). Brand button variants:
  `variant="kalima" | "kalimaOutline" | "kalimaWhite"` with `size="editorial"`.
- **Brand**: navy `#383C61` as ink on warm cream surfaces; serif display (Playfair) + tracked-caps
  sans (Jost); sharp corners (`--radius: 0`). See PROJECT_PLAN.md §2.
