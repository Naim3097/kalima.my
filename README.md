# Kalima Storefront — kalima.my

Custom e-commerce platform for Kalima (Timeless Modest Luxury). Next.js + Supabase.

**Build status:** Phases 0–8 are built and running against the live database — storefront, auth,
checkout with LeanX (FPX + e-wallets), the full admin back office, EasyParcel booking and tracking,
segmented email broadcasts, the affiliate program, Kalima Club loyalty, and the marketplace
stock-sync engine and the unified inbox. No phase is a mock-up any more.

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
    admin/               # Back office — all screens on live data
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
  lib/supabase/          # Browser, public (session-less), server + admin clients
  lib/commerce.ts        # Typed access to the order RPCs (server-only, admin client)
  lib/admin.ts           # Back-office read models + staff-gated mutations
  lib/payments/          # PaymentProvider seam + LeanX & Atome adapters; settle.ts is
                         #   the single place an order becomes paid, shared by both
  lib/shipping/          # EasyParcel client, OAuth tokens, rates, MY state → ISO codes
  lib/messaging/         # Audience segmentation (PDPA-gated) + campaign send pipeline
  lib/channels/          # Marketplace/messaging seam: adapters, tokens, sync worker, inbox
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
| **Atome** payments (BNPL, 3 instalments) | `src/lib/payments/atome.ts` → `/api/payments/atome/webhook` | 10 | ✅ built — needs merchant credentials |
| Transactional email (Resend) | `src/lib/email/` | 2 | ✅ live |
| Admin back office | `src/app/admin/`, `src/lib/admin.ts` | 3 | ✅ live |
| **EasyParcel** (rates, booking, AWB, tracking) | `src/lib/shipping/` → `/api/shipping/*` | 4 | ✅ built — needs API credentials |
| Email broadcasts + PDPA consent | `src/lib/messaging/`, `/admin/campaigns` | 5 | ✅ live |
| WhatsApp broadcasts (templates) | `src/lib/messaging/whatsapp.ts`, `src/lib/channels/whatsapp-templates.ts` | 5 | ✅ built — needs `META_WHATSAPP_WABA_ID` and an approved template |
| Affiliate engine | `src/lib/affiliate.ts`, `/affiliate` + `/admin/affiliates` | 6 | ✅ live |
| Loyalty ("Kalima Club") | `src/lib/loyalty.ts`, `/kalima-club` + `/admin/loyalty` | 7 | ✅ live |
| Marketplace stock sync | `src/lib/channels/`, `/admin/sync` | 8 | 🟡 engine live; Shopee/TikTok adapters await platform approval |
| Unified inbox — **WhatsApp** | `src/lib/channels/meta.ts`, `/admin/inbox` | 9 | ✅ live since 5 Aug 2026 — replies, templates, opt-out |
| Unified inbox — IG / FB / Shopee / TikTok | `src/lib/channels/` | 9 | 🟡 engine live; adapters await platform approval |

**There is no demo data left.** `src/data/demo.ts`, the `/api/admin/[resource]` fixture endpoint and
the "Demo preview" banner have all been deleted — every screen reads the live database.

**Connecting a channel?** [INSTRUCTION.md](./INSTRUCTION.md) is the per-platform runbook —
approvals to apply for, credentials to obtain, and the five adapter methods to implement, for
WhatsApp, Instagram, Facebook, Shopee and TikTok.

**Env-gated behaviour.** Integrations are null-until-configured and never fake success:

| Missing variable | Behaviour |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Order operations throw — required from Phase 2 on |
| `LEANX_AUTH_TOKEN` / `LEANX_COLLECTION_UUID` | Checkout completes as "order received, payment pending" |
| `LEANX_WEBHOOK_SECRET` | Payment webhook returns 401 — an order can never be marked paid |
| `ATOME_USERNAME` / `ATOME_PASSWORD` | Atome is absent from the payment picker; LeanX unaffected. The password doubles as the callback-signing key — Atome issues no separate webhook secret, so `X-Signature` is verified whenever Atome is configured at all |
| `ATOME_ENV` ≠ `production` | Atome stays on the `api.apaylater.net` sandbox — real money needs an explicit opt-in |
| `RESEND_API_KEY` | Emails no-op silently |
| `EASYPARCEL_*` | Shipping settings show disconnected; booking unavailable |
| `EASYPARCEL_WEBHOOK_SECRET` | Tracking webhook returns 503 — fails closed. Presented as `X-Webhook-Secret`; the query-string form is no longer accepted, because a secret in a URL lands in access logs |
| Supabase unconfigured entirely | Catalog falls back to `seed.sql` and `/admin` is ungated (local demo mode) |

## Environments

**Two Supabase projects.** Local and Vercel Preview run `Kalima staging`; Vercel
Production runs `Kalima`. Nothing in the code differs — every connection detail
comes from `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY`, scoped per environment in Vercel.

| | Domain | Branch | Supabase |
|---|---|---|---|
| Production | `www.kalima.my` | `main` | `Kalima` |
| Staging | `staging.kalima.my` | `staging` | `Kalima staging` |
| Local | `localhost:3000` | — | `Kalima staging` |

**Why they were split.** They shared one database until 2026-08-17, and it caused
three separate incidents in a day: a payment-test product published for a test
became reachable on the live site; real test orders (including a real RM11
charge) landed in the live back office; and stock edited in the *localhost* admin
did not appear on production for over two hours.

That last one is the instructive case. `adjustStock` does call
`revalidateProduct`, but **`revalidatePath` only purges the cache of the
deployment that runs it.** Writes are instantly global; cache purges are not. So
localhost purged localhost while production served a stale page until its own ISR
window lapsed. **Edit the catalogue in the production admin** — the same edit made
locally or on staging will not purge production.

**`supabase db push` targets whatever is linked, and the link is invisible.** The
CLI records it in `supabase/.temp/`, which is gitignored — there is no
`config.toml` to read. This machine is linked to **staging**. Check with
`supabase projects list` (the linked one is marked) before pushing, and re-run
`supabase link --project-ref <ref>` to change target. Production migrations have
been applied through the Supabase MCP rather than the CLI, so `db push` has never
pointed at production.

**Refreshing staging** — `node scripts/copy-catalogue.mjs` copies catalogue and
CMS data from production. It works from an explicit allowlist and never copies
orders, addresses, profiles, conversations, affiliates, the loyalty ledger, or
`channel_connections` (marketplace access tokens). It refuses to run if the target
is production, because it deletes before inserting. Needs
`STAGING_SUPABASE_URL` / `STAGING_SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.

Staging's `product_images.url` still points at production's public bucket, so
`NEXT_PUBLIC_LEGACY_IMAGE_HOST` allows that second host for `next/image`. Unset in
production. New uploads made on staging land in staging's own bucket.

Two knock-on facts worth knowing: staging's variants carry `stock_on_hand`
without the `stock_movements` that explain it, so its ledger will not reconcile —
expected, not a bug. And **migrations are now replayable from scratch**: building
the second project revealed that `supabase db push` applies them with a narrower
`search_path` than the dashboard, so unqualified `uuid_generate_v4()` and
`gen_random_bytes()` failed on a fresh database. Both are fixed at source; see the
note at the top of `20260720094446_catalog.sql`.

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

- **No saved address book.** The delivery address is captured at checkout each time; `/account`
  says so rather than showing a placeholder. The `addresses` table exists but nothing writes to it.
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
