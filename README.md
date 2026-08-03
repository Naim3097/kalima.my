# Kalima Storefront — kalima.my

Custom e-commerce platform for Kalima (Timeless Modest Luxury). Next.js + Supabase.

**Build status:** Phases 0–8 are built and running against the live database — storefront, auth,
checkout with LeanX (FPX + e-wallets), the full admin back office, EasyParcel booking and tracking,
segmented email broadcasts, the affiliate program, Kalima Club loyalty, and the marketplace
stock-sync engine. Phase 9 (unified inbox) is still a demo mock-up.

Phase 8's engine is complete — ledger trigger, debounced job queue, worker, inbound webhook and
admin screen — but Shopee and TikTok have issued no credentials, so their HTTP adapters are
deliberate stubs behind a provider seam. Until then the CSV import/export pair on `/admin/sync`
gives the client a working manual loop. See [PROJECT_PLAN.md](./PROJECT_PLAN.md) for the
phase-by-phase breakdown, and [Feature status](#feature-status) below for what that means route by
route.

## Stack

- **Next.js 16 (App Router) + React 19 + TypeScript** — Server Components by default, client islands where needed
- **Tailwind CSS v4** — design tokens in [`src/app/globals.css`](src/app/globals.css) (`@theme`)
- **shadcn/ui** — Radix primitives in [`src/components/ui/`](src/components/ui), restyled to the Kalima palette
- **Supabase** — Postgres + Auth + Storage via [`src/lib/supabase/`](src/lib/supabase); catalog, auth, orders, payments, shipping, affiliate and loyalty all live. RLS throughout; money moves only through `service_role`-only Postgres functions
- **TanStack Query 5** · **Zustand 5** (cart/wishlist/UI, persisted)
- **LeanX** payments (FPX + e-wallets) · **EasyParcel** shipping · **Resend** email

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
    admin/               # Back office (live, except /admin/inbox)
    api/                 # Route handlers: products, collections, admin resources,
                         #   payments/webhook, shipping/*, channels/* (OAuth, webhook, sync)
    auth/                # Sign-in/up/out server actions + email-confirmation callback
    checkout/actions.ts  # placeOrder — resolves the cart, calls create_order
  components/
    ui/                  # shadcn primitives (lowercase filenames)
    brand/               # Bespoke editorial: ProductCard, ProductImage, icons, placeholders
    layout/              # Header (server) + HeaderActions (client), nav, overlays, footer
    home/                # Hero carousel, category tiles, spotlight, best sellers, USP, lookbook
    admin/               # Admin shell + back-office widgets
  data/catalog.ts        # Types, seed fallback, nav + hero slides (client-safe)
  data/catalog.queries.ts# Supabase-backed catalog fetchers (server-only)
  data/demo.ts           # Sample datasets — now only /admin/inbox
  lib/supabase/          # Browser, public (session-less), server + admin clients
  lib/commerce.ts        # Typed access to the order RPCs (server-only, admin client)
  lib/admin.ts           # Back-office read models + staff-gated mutations
  lib/payments/          # PaymentProvider seam + LeanX (bills, services, webhook verify)
  lib/shipping/          # EasyParcel client, OAuth tokens, rates, MY state → ISO codes
  lib/messaging/         # Audience segmentation (PDPA-gated) + campaign send pipeline
  lib/channels/          # Marketplace/messaging seam: adapters, tokens, sync worker
  lib/affiliate.ts       # Referral ledger reads, application, payouts
  lib/loyalty.ts         # Points ledger reads, tier resolution, liability
  lib/email/             # Resend transactional templates
  lib/catalog-csv.ts     # Shared import/export row shape · lib/csv.ts — parser
  lib/format.ts          # formatRM()   ·   lib/utils.ts — cn()
  stores/                # Zustand: cart (free-shipping threshold), wishlist, UI drawers
  proxy.ts               # Session refresh, route gating, ?ref affiliate cookie
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

## Feature status

| Integration | Where it lives | Phase | Status |
|---|---|---|---|
| Supabase catalog | `src/data/catalog.queries.ts` | 1–2 | ✅ live |
| Supabase auth + roles | `src/lib/auth.ts`, `src/proxy.ts` | 0 | ✅ live |
| Orders + stock ledger | `src/lib/commerce.ts`, `create_order` / `mark_order_paid` | 2 | ✅ live |
| **LeanX** payments (FPX + e-wallets) | `src/lib/payments/leanx.ts` → `/api/payments/webhook` | 2 | ✅ live |
| Transactional email (Resend) | `src/lib/email/` | 2 | ✅ live |
| Admin back office | `src/app/admin/`, `src/lib/admin.ts` | 3 | ✅ live |
| **EasyParcel** (rates, booking, AWB, tracking) | `src/lib/shipping/` → `/api/shipping/*` | 4 | ✅ built — needs API credentials |
| Email broadcasts + PDPA consent | `src/lib/messaging/`, `/admin/campaigns` | 5 | ✅ live |
| WhatsApp Cloud API | same tables (`campaign_channel` enum has `whatsapp`) | 5 | ⛔ not built — blocked on Meta Business verification |
| Affiliate engine | `src/lib/affiliate.ts`, `/affiliate` + `/admin/affiliates` | 6 | ✅ live |
| Loyalty ("Kalima Club") | `src/lib/loyalty.ts`, `/kalima-club` + `/admin/loyalty` | 7 | ✅ live |
| Marketplace stock sync | `src/lib/channels/`, `/admin/sync` | 8 | 🟡 engine live; Shopee/TikTok adapters await platform approval |
| Unified inbox | `src/app/admin/inbox/` | 9 | 🎬 demo mock-up — gated on Shopee/TikTok/Meta approval |

`/admin/inbox` is the last screen reading from `src/data/demo.ts` — replace the data source, keep
the UI.

**Env-gated behaviour.** Integrations are null-until-configured and never fake success:

| Missing variable | Behaviour |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Order operations throw — required from Phase 2 on |
| `LEANX_AUTH_TOKEN` / `LEANX_COLLECTION_UUID` | Checkout completes as "order received, payment pending" |
| `LEANX_WEBHOOK_SECRET` | Payment webhook returns 401 — an order can never be marked paid |
| `RESEND_API_KEY` | Emails no-op silently |
| `EASYPARCEL_*` | Shipping settings show disconnected; booking unavailable |
| `EASYPARCEL_WEBHOOK_SECRET` | Tracking webhook returns 503 — fails closed |
| Supabase unconfigured entirely | Catalog falls back to `seed.sql` and `/admin` is ungated (local demo mode) |

## Money & data integrity

The rules every phase follows — worth knowing before changing anything downstream of an order:

- **Money is integer sen, computed server-side.** The browser never sends an amount. `create_order`
  recomputes price, discount, shipping, tax and loyalty redemption from the database. A tampered
  client can misdraw a preview, never change a price.
- **Anything that can drift is a ledger, never a stored total.** Stock (`stock_movements`),
  commission (`affiliate_referrals`), points (`loyalty_ledger`). Balances are summed from rows —
  there is deliberately no `points_balance` column anywhere.
- **Money-moving functions are `service_role`-only.** `create_order`, `mark_order_paid`,
  `refund_order`, `adjust_stock`, `award_loyalty_points`, `revoke_loyalty_points`,
  `record_affiliate_referral`. `anon` and `authenticated` hold no grant on any of them.
- **Payment is confirmed by webhook only**, never a browser redirect. `mark_order_paid` is the only
  path to `paid`, is idempotent, and rolls back the whole payment if any line is unfulfillable.
- **Refunds are one function, one path.** `refund_order` returns stock, claws back commission and
  reverses points in a single transaction — reached identically from the admin action and the LeanX
  refund webhook.
- **`SECURITY DEFINER` helpers live in the `private` schema** so PostgREST cannot call them; route
  gating is enforced in `proxy.ts` *and* re-checked in the admin layout and every mutating action.
- **The audit log is append-only by construction** — staff hold a SELECT policy and no
  insert/update/delete policy at all, so only service-role server actions can append.

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

## Known gaps

Carried openly rather than hidden in the phase list:

- **`/account` is half-real.** The identity block and order history read from the session and the
  database, but the Kalima Club card, points history, address book and preferences are still
  hardcoded — the real member view lives at `/kalima-club`. The page's demo badge is also stale
  (it says orders are demo; they are not).
- **Checkout's free-shipping *display* threshold** is the client-side default in
  `src/stores/cart.ts`; the *charged* total is server-authoritative from `store_settings`. Wiring
  the live threshold into the estimate is a small follow-up.
- **PLP filter sidebar and pagination** were never built (Phase 1 leftover). Sort works.
- **No cart page and no DB-backed cart** — the cart is a persisted Zustand store and a drawer.
  Guest-cart-merge-on-login is not implemented.
- **No CI, no automated tests, single Supabase project** (no staging/prod split). Verification to
  date is live-database manual testing, recorded per commit — `git log` is the most accurate
  record of what was checked.
- **EasyParcel is code-complete but unexercised** against the real API; no credentials issued yet.
- **Phase 10 (SEO, analytics, monitoring, launch runbook) has not started.**
