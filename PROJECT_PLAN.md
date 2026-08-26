# KALIMA.MY — E-Commerce Platform Build Plan

**Project:** Kalima — Timeless Modest Luxury (kalima.my)
**Type:** Custom e-commerce storefront + admin back-office (EasyStore-class features, self-hosted)
**Stack:** Next.js 16 (App Router) + React 19 + TypeScript · Supabase (Postgres, Auth, Storage)
**Market:** Malaysia (MYR, BM/EN, FPX-first payments, EasyParcel logistics)
**Prepared by:** Nexova Digital
**Date:** 17 July 2026 · **Last reconciled against the codebase:** 3 August 2026

> ### 📍 Build status
>
> | Phase | State |
> |---|---|
> | 0 — Foundations & auth | ✅ **Done** (domain/DNS cutover outstanding) |
> | 1 — Storefront UI | ✅ **Done** (PLP filters + pagination outstanding) |
> | 2 — Commerce core | ✅ **Done** — LeanX live (FPX + e-wallets) |
> | 3 — Admin back office | ✅ **Done** |
> | 4 — EasyParcel shipping | ✅ **Built** — awaiting API credentials to exercise live |
> | 5 — Messaging & broadcast | ✅ **Email and WhatsApp done** (WhatsApp needs an approved template) |
> | 6 — Affiliate program | ✅ **Done** |
> | 7 — Loyalty / Kalima Club | ✅ **Done** |
> | 8 — Marketplace stock sync | 🟡 **Engine built** — Shopee/TikTok adapters await app approval |
> | 9 — Unified inbox | 🟡 **Engine built** — channel adapters await Meta/Shopee/TikTok approval |
> | 10 — QA, SEO & launch | ⛔ **Not started** |
>
> The original plan assumed a Vite SPA and an undecided payment gateway. Both changed during the
> build: the app was migrated to **Next.js 16 App Router** (server-rendered, which also retires the
> SPA-SEO risk in §9) and **LeanX** was selected as the gateway. §4 and §5 below have been rewritten
> to describe what was actually built; the phase checklists carry per-item notes where the delivered
> scope differs from what was planned.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [UI Concept Analysis (from approved mockup)](#2-ui-concept-analysis)
3. [Client Feature Requests — Feasibility Matrix](#3-client-feature-requests--feasibility-matrix)
4. [Technical Architecture](#4-technical-architecture)
5. [Database Schema (high level)](#5-database-schema-high-level)
6. [Build Phases](#6-build-phases)
   - [Phase 0 — Foundations & Project Setup](#phase-0--foundations--project-setup)
   - [Phase 1 — Storefront UI (Design System + Pages)](#phase-1--storefront-ui)
   - [Phase 2 — Commerce Core (Cart, Checkout, Payments, Orders)](#phase-2--commerce-core)
   - [Phase 3 — Admin Dashboard](#phase-3--admin-dashboard)
   - [Phase 4 — Shipping: EasyParcel Integration](#phase-4--shipping-easyparcel-integration)
   - [Phase 5 — Customer Messaging & Bulk Broadcast](#phase-5--customer-messaging--bulk-broadcast)
   - [Phase 6 — Affiliate Program](#phase-6--affiliate-program)
   - [Phase 7 — Loyalty & Membership](#phase-7--loyalty--membership)
   - [Phase 8 — Marketplace Stock Sync (Shopee + TikTok Shop)](#phase-8--marketplace-stock-sync-shopee--tiktok-shop)
   - [Phase 9 — Unified Inbox (Shopee / TikTok / Instagram / WhatsApp)](#phase-9--unified-inbox-shopee--tiktok--instagram--whatsapp)
   - [Phase 10 — QA, SEO, Performance & Launch](#phase-10--qa-seo-performance--launch)
7. [Timeline Summary](#7-timeline-summary)
8. [Third-Party Accounts & Prerequisites (Client Action Items)](#8-third-party-accounts--prerequisites-client-action-items)
9. [Risks & Open Questions](#9-risks--open-questions)

---

## 1. Project Overview

Kalima is a Malaysian modest-fashion brand (women's & men's wear, hijabs, accessories). The goal is a fully custom e-commerce platform that replaces the need for a hosted platform like EasyStore, while adding capabilities EasyStore does not offer out of the box:

- Direct customer messaging & bulk broadcast (WhatsApp-first)
- Built-in affiliate program with trackable codes/links
- Loyalty points & membership tiers ("Kalima Club")
- EasyParcel shipping integration (rate quotes, label generation, tracking)
- Inventory sync with Shopee and TikTok Shop
- A unified inbox for marketplace/social messages (feasibility-gated)

**Why custom (Next.js + Supabase) instead of a hosted platform:** full ownership of customer data (critical for messaging/loyalty/affiliate features), no monthly platform fees or transaction fee lock-in, and freedom to integrate any Malaysian service (LeanX, EasyParcel, Shopee, TikTok) without app-store limitations.

---

## 2. UI Concept Analysis

Detailed breakdown of the approved homepage mockup (`assets/mockup image.png`). This defines the design system for the whole storefront.

### 2.1 Brand & Art Direction

| Element | Observation |
|---|---|
| **Mood** | Quiet luxury, editorial, warm minimalism. Lots of whitespace, soft studio photography, silk/satin textures, arched shapes. |
| **Palette** | Warm ivory/cream page background (~`#F7F3EC`), deeper beige section bands (~`#EFE7DB`), dark ink for text/buttons, muted product tones (sage, blush, taupe, chocolate). Brand ink is **Kalima Navy `#383C61`** — see §2.1.1. |
| **Typography** | High-contrast editorial **serif** for display headings ("Timeless Modest Luxury", "Maya Collection", section labels like WOMEN/MEN) — e.g. Playfair Display, Cormorant, or Marcellus. Clean geometric **sans-serif** for body, nav, prices, buttons — e.g. Jost, Inter, or Montserrat. Heavy use of **uppercase + wide letter-spacing** for eyebrows, nav items, and buttons. |
| **Buttons** | Primary: solid near-black rectangle, white uppercase tracked label (`SHOP COLLECTION`). Secondary: thin-border outline on cream (`NEW ARRIVALS`). Sharp corners (no radius). |
| **Imagery** | Warm-toned studio photography, models in modest wear, flowing fabric backdrops, occasional arch-masked images (Maya Collection block). |
| **Currency** | `RM` prefix (MYR), no decimals shown at storefront level (RM295, RM50). |

### 2.1.1 Official Brand Colors (extracted from logo files)

Pixel-sampled from all four supplied logo assets — the blue is byte-identical across PNG and JPG versions, so these are the definitive brand values:

| Token | Hex | RGB | Source / Usage |
|---|---|---|---|
| **Kalima Navy** (primary) | `#383C61` | `56, 60, 97` | Dominant color in all 4 logo files. Primary brand ink: logo, headings, primary buttons, links, active states. |
| **White** | `#FFFFFF` | `255, 255, 255` | Logo reverse. Text/logo on navy surfaces. |
| Navy 700 (hover/pressed) | `#2C2F4D` | `44, 47, 77` | Derived shade — button hover, pressed states. |
| Navy 400 (muted) | `#686C8F` | `104, 108, 143` | Natural tint (sampled from logo edge blend). Secondary text on cream, icons, captions. |
| Navy 300 (soft) | `#9B9CB0` | `155, 156, 176` | Natural tint (sampled). Borders, dividers, disabled states. |
| Navy 100 (wash) | `#EBECF2` | `235, 236, 242` | Derived tint — subtle navy-tinted backgrounds, badges, selected rows. |
| Cream (page bg) | `#F7F3EC` | `247, 243, 236` | From mockup — page background. |
| Beige (section band) | `#EFE7DB` | `239, 231, 219` | From mockup — USP strip, newsletter band. |

**Recommended palette resolution:** the mockup was rendered in cream/near-black before final logos were supplied. Navy `#383C61` on warm cream is a harmonious, elevated pairing — so the direction is: keep the mockup's cream/beige surfaces and photography style, and use **Kalima Navy as the ink** (wordmark, nav, headings, primary buttons, prices) wherever the mockup used near-black. White logo variant on navy for the footer/dark surfaces. Contrast check: `#383C61` on `#F7F3EC` ≈ **9.5:1** (passes WCAG AAA for normal text) — safe for all UI text and buttons.

> ✅ **Brand note (resolved):** exact brand colors confirmed from supplied logo files. Remaining client confirmation is stylistic only — approve navy-as-ink over the mockup's near-black (see [Open Questions](#9-risks--open-questions)).

### 2.2 Section-by-Section Breakdown (top → bottom)

1. **Announcement bar** — slim cream strip, centered message *"FREE SHIPPING for orders above RM300"* with left/right chevrons → a rotating multi-message carousel, admin-editable.
2. **Header (3-zone)** —
   - Left: `Search` (icon + label, opens search overlay), `Stores` (physical store locator page).
   - Center: KALIMA wordmark, wide-tracked serif, with sub-tagline "TIMELESS MODEST LUXURY" in micro caps.
   - Right: `Account`, `Wishlist` (heart), `Bag (0)` with live item count → slide-out mini-cart drawer.
3. **Primary navigation** — uppercase micro labels: `WOMEN ▾ · MEN ▾ · SIGNATURE ▾ · COLLECTIONS · ACCESSORIES · FABRICS · RAYA COLLECTION · ABOUT KALIMA`. The three carets imply **dropdown/mega-menus** (category trees). `RAYA COLLECTION` is a seasonal campaign slot — nav must be admin-manageable.
4. **Hero carousel** — full-bleed image slider with pagination dots. Left-aligned content block: eyebrow (`NEW COLLECTION`), large serif H1 (`Timeless Modest Luxury`), one-line subcopy (*"Designed in Malaysia for every beautiful journey."*), dual CTAs (solid + outline). Each slide = image, heading, copy, 2 CTA links — CMS-driven.
5. **Category tiles** — 3-up grid (WOMEN / MEN / ACCESSORIES): image card, overlaid serif label, `Explore Now →` hover affordance. Links to category listing pages.
6. **Featured collection band ("Maya Collection")** — split layout: text left on cream (eyebrow, serif heading, 2-line description, underlined `DISCOVER COLLECTION →` link), arch-masked lifestyle image right. Reusable "collection spotlight" CMS block.
7. **Best Sellers product rail** — section header row (`BEST SELLERS` left / `View All →` right), **5-column product card grid**. Product card anatomy:
   - Portrait product image (4:5-ish) with a circular wishlist heart button top-right
   - Product name (sans, sentence case)
   - Price `RM xxx`
   - **Color swatch dots** (3–4 per product) → products have color variants; swatch click should swap card image
   - Mockup seed products: Maya Luna RM295 · Maya Chiffon RM250 · Amanda Sparkle RM250 · Cardigan Premium RM210 · Stretchable Rayon Inner RM50
8. **USP strip** — full-width beige band, 5 icon columns: *Made in Malaysia · Premium Fabrics · In-house Design · Inclusive Sizing · Sustainable Fashion*, each with a thin-line icon and 2-line caption.
9. **Lookbook / Instagram grid** — `LOOKBOOK` header + `View Instagram →`, 5-up image grid of styled shots (some with wishlist hearts → shoppable lookbook posts tagged to products).
10. **Newsletter band ("Join Kalima Club")** — satin-texture cream band, serif heading, supporting copy (*"Be the first to know about new collections, exclusive offers and private sales."*), inline email input + solid black `SUBSCRIBE` button. **Note: "Kalima Club" doubles as the loyalty/membership brand (Phase 7).**
11. **Trust footer bar** — 4 icon columns: Free Shipping (~~orders above RM500 — ⚠️ mockup inconsistency vs RM300 announcement bar~~ — ✅ **resolved:** the threshold is now a `store_settings` field editable at `/admin/settings`, read server-side by `create_order`) · Easy Returns (14-day policy) · Secure Payment · Customer Support.
12. *(Implied, not shown)* Full footer: link columns, social icons, payment method logos, copyright — standard build.

### 2.3 Pages Implied by the Mockup

| Page | Source |
|---|---|
| Home | The mockup itself |
| Category / Collection listing (PLP) with filters | Nav items, category tiles, "View All" |
| Product detail (PDP) with variant/swatch selection | Product cards with color dots |
| Search results + search overlay | Header "Search" |
| Store locator | Header "Stores" |
| Account (profile, orders, addresses, loyalty, affiliate) | Header "Account" |
| Wishlist | Header heart icon |
| Cart drawer + Cart page + Checkout flow | "Bag (0)" |
| About Kalima / Fabrics (content pages) | Nav items |
| Raya Collection (campaign landing) | Nav item |
| Lookbook | Lookbook section |
| Policies: shipping, returns (14-day), privacy, terms | Trust bar |

---

## 3. Client Feature Requests — Feasibility Matrix

*Feasibility was the question at proposal time. The **Built** column records where each request
actually landed.*

| # | Client request | Feasibility | Built | Approach | Phase |
|---|---|---|---|---|---|
| 1 | Message / bulk message to customers | ✅ Fully feasible | ✅ Email and WhatsApp live | WhatsApp Business Cloud API (template broadcasts) + transactional email (Resend). Segmented audiences from our own customer DB. | 5 |
| 2 | Affiliate code | ✅ Fully feasible | ✅ Live | Native build: unique codes + referral links, click & order attribution, commission ledger, payout tracking, affiliate portal. | 6 |
| 3 | Loyalty / membership | ✅ Fully feasible | ✅ Live | Native build: points ledger, tier system ("Kalima Club": e.g. Member/Gold/Platinum), earn on purchase, redeem at checkout, birthday rewards. | 7 |
| 4 | Link postage to EasyParcel | ✅ Fully feasible | 🟡 Built; needs API credentials | EasyParcel Individual/Marketplace API: live rate quotes at checkout, one-click consignment booking from admin, AWB label PDF, tracking webhooks → auto customer notification. | 4 |
| 5 | Stock sync with Shopee & TikTok Shop | ✅ Feasible (approval-gated) | 🟡 Engine built; adapters await approval | Shopee Open Platform API + TikTok Shop Open Platform API. SKU mapping table, near-real-time stock push on our sales, webhook-driven stock pull on marketplace sales. Requires developer app approval on both platforms (lead time). | 8 |
| 6 | Read TikTok / IG / Shopee messages in one place | ✅ Feasible (approval-gated) | 🟡 Engine built; adapters await approval | **Shopee:** ✅ chat API via Open Platform. **TikTok Shop:** ✅ customer-service conversation API for approved apps. **TikTok organic DMs:** ✅ **Business Messaging API** — Kalima's TikTok account is a Business account, which unlocks send/receive of organic TikTok DMs (48h reply window). **Instagram + FB Page:** ✅ via Meta's Messenger API for Instagram — requires Meta App Review + IG professional account linked to a FB Page. **WhatsApp:** ✅ Cloud API (already integrated in Phase 5). Only gap: TikTok *personal/creator* DMs (no API on any platform) — not relevant here, since Kalima runs a Business account. | 9 |

**Honest summary for the client:** items 1–6 boleh buat semua. Item 6 (unified inbox) covers Shopee chat, TikTok **Shop** buyer chat, **TikTok organic DMs** (Kalima's TikTok is a Business account, so the TikTok Business Messaging API applies), Instagram DM + Facebook Page (lepas Meta approval), and WhatsApp — semua dalam satu inbox, reply terus dari sana. The only thing with no API anywhere is TikTok *personal/creator* DMs, which does not apply to a Business account. This is beyond what EasyStore offers at any tier, and no third-party vendor sells this exact channel mix (see [INTEGRATION_STRATEGY.md §2⑥](./INTEGRATION_STRATEGY.md)).

> **Client priority (confirmed):** the goal is **unification — read and reply to every channel from one place** — not outbound blasting. Broadcast (Phase 5) stays in scope for transactional/opt-in messaging, but Phase 9's inbox is the headline: one screen, every conversation, each linked to the customer's orders and Kalima Club profile.

---

## 4. Technical Architecture

### 4.1 Stack

*Rewritten to match what was built. Changes from the original plan are flagged **[changed]**.*

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **Next.js 16 (App Router) + React 19 + TypeScript** **[changed — was Vite SPA]** | Server Components by default; only interactive leaves ship JS. Catalog routes prerender with hourly ISR. Migrating off the SPA also retired the SEO risk in §9. |
| Styling | **Tailwind CSS v4** + design tokens | Tokens in `src/app/globals.css` (`@theme`), derived from §2.1. shadcn/ui over Radix for interactive primitives. |
| Routing | Next App Router **[changed — was React Router v7]** | `(storefront)` route group + `/admin` + `/affiliate`, role-gated in `src/proxy.ts` (Next 16's renamed middleware) and re-checked server-side. |
| Server state | TanStack Query | Client-side catalog hooks only; server components fetch directly. |
| Client state | Zustand | Cart, wishlist, UI drawers — persisted to localStorage. **DB-synced carts were not built.** |
| Backend | **Supabase** | Postgres + Row Level Security, Auth, Storage (product images). **[changed]** No Edge Functions: all server work runs in Next route handlers and server actions on Vercel, which keeps one language and one deploy. `pg_cron` unused so far. |
| Payments | **LeanX** — FPX + e-wallets **[changed — resolved from the Stripe/toyyibPay/Billplz open question]** | Silent Bill flow, HMAC-SHA256 webhook verification, webhook-driven confirmation. See `LEANX_SAAS_INTEGRATION_GUIDE.md`. |
| Email | Resend (transactional + campaigns) | Order confirmations, payment receipts, marketing broadcasts. |
| WhatsApp | Meta WhatsApp Business Cloud API | **Built** (20 Aug 2026) — template broadcasts off the same segment engine, phone-keyed audience, `STOP` opt-out. Needs `META_WHATSAPP_WABA_ID` and at least one Meta-approved template. |
| Shipping | EasyParcel (OAuth) | Rates, booking, AWB, tracking webhook. **[changed]** Admin booking tool, **not** a checkout courier picker — see Phase 4. |
| Marketplaces | Shopee Open Platform v2, TikTok Shop Open Platform | Not built (Phase 8). |
| Hosting | Vercel + Supabase Cloud (`gylsymfonxyegdlfodvk`, Singapore) | `kalima.my` apex + `/admin` from the same app. Single Supabase project — no staging/prod split yet. |
| Analytics | GA4 + Meta Pixel + TikTok Pixel | Not wired yet (Phase 10). |

### 4.2 Architecture Principles

These held through the build and are worth reading before changing anything downstream of an order.

- **All secrets & third-party calls stay server-side** — LeanX/EasyParcel/Resend keys live in Next
  route handlers and server actions, never in the browser. **[changed]** The plan said Supabase Edge
  Functions; Next server code does the same job in one language and one deploy.
- **RLS everywhere:** customers see only their own rows; `admin`/`staff` via the JWT
  `app_metadata.role` claim; affiliates see only their own referrals. `SECURITY DEFINER` helpers
  live in the `private` schema so PostgREST cannot call them.
- **Money is integer sen, computed server-side, always.** The browser never sends an amount.
  `create_order` recomputes price, discount, shipping, tax and loyalty redemption from the database.
- **Anything that can drift is a ledger, never a stored total.** Stock (`stock_movements`),
  commission (`affiliate_referrals`), points (`loyalty_ledger`). Balances are summed from rows —
  there is deliberately no stored balance column anywhere. A running total that can disagree with
  the rows it summarises is how someone gets paid twice.
- **Money-moving functions are `service_role`-only:** `create_order`, `mark_order_paid`,
  `refund_order`, `adjust_stock`, `award_loyalty_points`, `revoke_loyalty_points`,
  `record_affiliate_referral`. `anon` and `authenticated` hold no grant on any of them.
- **Money integrity:** orders/payments state machines
  (`pending → paid → fulfilled → completed / cancelled / refunded`); payment confirmed **only** by
  gateway webhook, never by client redirect. `mark_order_paid` is idempotent and rolls the whole
  payment back if any line is unfulfillable.
- **One refund path.** `refund_order` returns stock, claws back commission and reverses points in a
  single transaction, reached identically from the admin action and the gateway refund webhook —
  rather than parallel paths a caller could forget.
- **Inbound webhooks fail closed.** No secret configured means every request is rejected, never
  accepted. Signatures/secrets are compared in constant time.
- **Audit is append-only by construction** — staff hold SELECT and no write policy at all, so only
  service-role server actions can append.
- **Webhook-first, poll-fallback** for marketplace sync (Phase 8, not yet built): webhooks can be
  delayed or dropped, so `pg_cron` reconciliation every 15 min is planned as the safety net.

---

## 5. Database Schema (high level)

**30 migrations applied.** `supabase/migrations/` is a faithful, replayable record of the live
schema — every file is named `<applied_version>_<applied_name>.sql` and was verified byte-exact
against `supabase_migrations.schema_migrations` (commit `3c8b0a5`, after the repo had drifted).

### ✅ Built

**Catalog:** `collections`, `products`, `product_variants` (SKU, colour, size, price_sen, weight,
stock_on_hand), `product_images` (+ `storage_path`), `collection_products`

**Customers & auth:** `profiles` (extends `auth.users`; phone in E.164, PDPA consent),
`role_grants` (sign-up role allowlist), `addresses`, `newsletter_subscribers` (consent timestamp +
source, unsubscribe token)

**Commerce:** `orders`, `order_items`, `payments`, `discount_codes`, `discount_redemptions`,
`stock_movements` (ledger: sale / restock / adjustment / release / marketplace_sync)

**Shipping:** `shipments` (courier-agnostic — `manual` or a provider booking with AWB, label URL,
cost, weight), EasyParcel OAuth tokens + pickup address on `store_settings`

**Messaging:** `campaigns`, `campaign_recipients` — channel-agnostic (`campaign_channel` enum
already carries `whatsapp`)

**Affiliate:** `affiliates`, `affiliate_clicks`, `affiliate_referrals` (order-level attribution +
commission, `unique(order_id)`), `affiliate_payouts`

**Loyalty:** `loyalty_rules` (single row), `membership_tiers`, `loyalty_ledger`
(earn / redeem / expire / adjust, unique earn per order)

**CMS / settings / audit:** `announcements`, `hero_slides`, `content_pages`, `store_settings`
(single row — shipping threshold, flat rate, tax, store info), `admin_audit_log` (append-only)

### ⛔ Planned but not built

- `categories` (tree), `lookbook_posts`, `wishlists` — wishlist is a client-side store
- `carts` / `cart_items` — the cart is localStorage only; no guest-cart merge on login
- `customer_tags` — segmentation is behavioural instead (spend, recency, buyer status) in
  `src/lib/messaging/audience.ts`
- `shipping_zones`, `shipment_tracking_events` — flat rate from settings; tracking status is a
  column, not an event log
- `message_logs` — never built; `campaign_recipients` (broadcasts) and `messages` (inbox) are the
  delivery log. `message_templates` arrived as **`whatsapp_templates`**, a write-locked cache of
  Meta's registry rather than a table we author into — Meta owns approval, so Meta owns the row
- Phase 8: `channel_connections`, `channel_listings`, `channel_orders`, `sync_jobs` / `sync_logs`
- Phase 9: `conversations`, `messages`, `inbox_assignments`
- `content_blocks`, `store_locations` — deferred CMS passes

> `shipping_quotes` was built and then **dropped** (`20260723105012`) when Phase 4 was rescoped:
> quote-freezing exists to stop an untrusted browser choosing its own shipping price, and there is
> no untrusted party in an admin-only booking flow.

---

## 6. Build Phases

> ### 🗺️ Route status — what is live vs still a mock-up
> Only **two** screens remain demo previews. Those read from `src/data/demo.ts` and carry a
> "Demo preview" badge; everything else is driven by the live database.
>
> | Route | What it does | Status |
> |---|---|---|
> | `/` | Full storefront, DB-backed catalog + CMS content | ✅ live |
> | `/products/*` · `/collections/*` · `/pages/*` | PDP, PLP, content pages — prerendered, hourly ISR | ✅ live |
> | `/checkout` → `/checkout/pay` → `/checkout/success` | Real orders, server-computed totals, discount codes, **points redemption**, LeanX FPX/e-wallet, webhook-confirmed | ✅ live |
> | `/kalima-club` | Member standing — balance, value, tier progress, points history; scheme explainer when signed out | ✅ live |
> | `/account` | Identity + real order history w/ tracking links | 🟡 **part demo** — the Club card, points activity, address book and preferences are still hardcoded; the real member view is `/kalima-club` |
> | `/affiliate` | Affiliate portal — application, status, referral link/code, Held vs Payable earnings | ✅ live |
> | `/admin` | KPIs, real 14-day sales chart, top products, recent orders | ✅ live |
> | `/admin/orders` · `/admin/products` · `/admin/customers` · `/admin/discounts` | Ops tables, product editor, ledger-backed stock, CSV import/export, LTV, discount management | ✅ live |
> | `/admin/orders/[ref]/packing-slip` · `/admin/orders/packing-slips` | Single + bulk printable packing slips | ✅ live |
> | `/admin/cms` · `/admin/settings` · `/admin/staff` · `/admin/audit` | Announcements/hero/pages, store + shipping + tax settings, roles, append-only audit trail | ✅ live |
> | `/admin/campaigns` | **① Bulk messaging** — segments, composer, send, delivery report | ✅ **email and WhatsApp live** |
> | `/admin/affiliates` | **② Affiliate program** — approve/suspend, rates, discount code, payouts | ✅ live |
> | `/admin/loyalty` | **③ Loyalty** — outstanding liability, earn/redeem rules, tiers | ✅ live |
> | `/admin/shipping` | **④ EasyParcel** — connection status, pickup address, rates, booking, AWB | ✅ built, needs credentials |
> | `/admin/sync` | **⑤ Shopee & TikTok stock sync** — connections, SKU mapping, CSV import/export, activity | ✅ live; adapters pending |
> | `/admin/inbox` | **⑥ Unified inbox** — threads, customer context, notes, canned replies, reply-window enforcement | ✅ live; adapters pending |

### Phase 0 — Foundations & Project Setup
**Status: ✅ done — domain/DNS outstanding**
**Duration: ~1 week**

- [x] Repo init (Git) — *done; branch strategy + CI pipeline still pending*
- [x] ~~Vite + React + Router v7~~ → **migrated to Next.js 16 App Router** + React 19 + TS + Tailwind v4 + TanStack Query + Zustand (commit `47fb56b`)
- [x] Supabase project + migrations workflow + seed scripts — *live (`gylsymfonxyegdlfodvk`, Singapore); 30 migrations applied, `seed.sql` generated from `catalog.ts`. Single production env for now, not staging+prod.*
- [x] Design tokens from §2.1/§2.1.1 in `src/app/globals.css` (`@theme`) — Kalima Navy `#383C61` scale, cream/beige surfaces, Playfair Display + Jost pairing, tracked-caps label utility
- [x] Base component library: Button (solid/outline/white), section header, product card w/ swatches, placeholder imagery, 20-icon thin-line set
- [x] Auth skeleton: email/password sign-in, phone capture, roles (`customer`/`staff`/`admin`/`affiliate`) — *done: Supabase Auth + `profiles`, role in JWT `app_metadata`, signup pipeline with an admin allowlist, self-elevation blocked. `/admin` gated on staff/admin, `/account` on any signed-in user. **Google sign-in deferred** (needs a Google OAuth app); magic link not built.*
- [ ] Domain + DNS for `kalima.my`, staging URL

**Exit criteria:** deployed "hello storefront" on staging with auth working and design tokens applied.

---

### Phase 1 — Storefront UI
**Status: ✅ done — PLP filters + pagination outstanding**
**Duration: ~2–3 weeks** — pixel-faithful build of the mockup + all implied pages (§2.3).

- [x] **Announcement bar** — rotating messages w/ arrows; *now admin-editable via the Phase 3 CMS*
- [x] **Header + nav** — dropdown menus (WOMEN/MEN/SIGNATURE), sticky on scroll, mobile drawer nav, search overlay (client-side name search; *Postgres full-text still not built*)
- [x] **Home page** — hero carousel, category tiles, Maya collection spotlight (arch mask), best-sellers rail, USP strip, lookbook grid, newsletter signup, trust bar, navy footer w/ white logo
- [x] **Product card** — placeholder imagery, wishlist toggle, name, RM price, color swatches w/ image-tone swap on click
- [ ] **PLP (category/collection)** — breadcrumb + sort (featured/price) **done**; ⛔ *filter sidebar (size, colour, price, fabric) and pagination were never built — the one open Phase 1 item*
- [x] **PDP** — color/size selection, add-to-bag → cart drawer, accordions (description/fabric/shipping), loyalty points teaser, related products; *stock states + notify-me still not built*
- [x] **Wishlist page** (persisted), **content page stubs** (About, Fabrics, Shipping, Returns, Stores, Kalima Club); *Raya campaign landing template + shoppable lookbook tags still to do*
- [x] Responsive mobile-first layout (hamburger drawer, 2-col grids); *skeleton loaders + image optimization pending real photography*
- [x] **Photography drop-in (partial)** — 7 model shots wired in across 5 SKUs (hero, category tiles, Maya spotlight arch, best sellers, lookbook, PDP, cart), incl. **per-colour variant photos** on Ruwa Kaftan (Peach/Lilac/Powder Blue — swatch click swaps the photo); remaining catalog items render branded placeholders until shots are supplied (§8)
- [x] Cart drawer w/ free-shipping progress bar (RM300 threshold, configurable in `src/stores/cart.ts`)

**Exit criteria:** client walkthrough of complete storefront on staging with seeded catalog (mockup's 5 best-sellers + Maya collection).

---

### Phase 2 — Commerce Core
**Status: ✅ done**
**Duration: ~2–3 weeks** — *commits `71245b8`, `64e8a2e`, `5b7b24e`*

- [x] **Cart** — mini-cart drawer + free-shipping progress bar. ⛔ *No cart page and no DB-backed cart: the cart is a persisted Zustand store, so guest-cart-merge-on-login was not built.*
- [x] **Checkout** — contact, Malaysian address, discount code, order summary; flat shipping computed server-side from `store_settings`
- [x] **Payments — LeanX** (FPX + e-wallets): Silent Bill flow, bank/e-wallet picker at `/checkout/pay`, HMAC-SHA256 webhook verification over the raw body, timing-safe and fail-closed. `bill_no` is the idempotency anchor. ⛔ *Abandoned-payment recovery not built.*
- [x] **Payments — Stripe** (Visa / Mastercard, built 26 Aug 2026 — client has a Stripe account): third `PaymentProvider` in `src/lib/payments/stripe.ts` using **Stripe Checkout** (hosted; no card data touches the site, PCI SAQ-A). One "Card" option on `/checkout/pay`; a Checkout Session per attempt (idempotent on `KLM-…-n`), one-hour expiry so the sweep can close abandoned sessions safely; `client_reference_id` carries the order reference. Webhook `/api/payments/stripe/webhook` verifies `Stripe-Signature` (HMAC-SHA256, 5-minute tolerance, constant-time) and feeds the shared `settlePaymentWebhook` — amount check, idempotent `mark_order_paid`, side effects once. `charge.refunded` reaches the same refund path as LeanX's. **Stripe refunds are real**: the admin Record Refund action sends the refund to Stripe first for card orders and records nothing if Stripe refuses. Health endpoint reports key mode (test/live) and account `charges_enabled`. `scripts/stripe-register-webhook.mjs` registers the endpoint and prints the signing secret. ⛔ *Awaiting `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` on Vercel Preview/Production and a 4242 test payment on staging.*
- [x] **Orders** — full state machine, confirmation page + email, stock decrement through the `stock_movements` ledger with oversell guard. `mark_order_paid` is the only path to `paid`, is idempotent, and rolls the entire payment back if any line is unfulfillable
- [x] **Customer account area** — real profile, real order history with tracking links, password reset + in-account change (reauthenticated). ⛔ *Address book and status timeline not built; the account page's Club card is still hardcoded*
- [x] **Discount codes** — % / fixed / free-shipping, min spend, usage limits, expiry; validated server-side against a server-computed subtotal
- [x] Email notifications — Resend order-received + payment-confirmed, brand-styled, null until `RESEND_API_KEY`

**Exit criteria:** ✅ met — end-to-end order → `create-bill-silent` → bank redirect → signature-verified webhook → order paid, stock decremented via the ledger, payment row written, replay idempotent, tampered amount rejected 409.

---

### Phase 3 — Admin Dashboard
**Status: ✅ done**
**Duration: ~2–3 weeks** — the EasyStore-replacement back office at `/admin`. *Commits `149af74`, `784c844`, `9e080fb`, `5130519`, `49e97f6`, `3e35a43`, `c98cc4b`, `2ff4476`, `8e7b931`*

- [x] **Dashboard** — today/7d/30d sales, orders, AOV, real 14-day chart, top products (30d), recent orders. *Channel breakdown waits on Phase 8*
- [x] **Products** — CRUD, variant matrix editor with inline weight, image upload w/ drag-sort, ledger-backed stock, CSV import/export
  - Images: the browser PUTs straight to Storage using a short-lived signed URL minted by a staff-gated action, scoped to a single random object key — bytes never pass through a server action and a client filename can never dictate the storage path
  - Stock has **no absolute input**, only signed deltas through `adjust_stock`, so the ledger stays complete. The CSV importer moves stock by computed delta for the same reason
  - CSV: dependency-free parser handling quoted commas, escaped quotes, embedded newlines, CRLF and Excel's BOM. The whole file validates before anything is written, so a typo on line 40 cannot half-import a catalog
- [x] **Orders** — filters & search, detail view, status updates, packing slip print (single + bulk)
  - **Refunds:** ⛔ LeanX publishes no refund API, so money moves in the LeanX dashboard and the UI says so plainly. `refund_order` handles everything on our side — returns stock as a `release`, reverses commission and points, idempotent, reached identically from the admin action and the gateway refund webhook. *This phase fixed two real bugs: "Mark refunded" was a bare status flip that permanently understated inventory, and an inbound `refunded` webhook was acknowledged and ignored.*
- [x] **Customers** — list, per-customer order count + lifetime value, role, marketing consent. ⛔ *Tag-based segmentation was replaced by behavioural filters in Phase 5 (spend, recency, buyer status); no `customer_tags` table*
- [x] **Discounts** — code table, create/edit dialog, instant active toggle
- [x] **CMS** — announcements, hero slides, content pages, each with public-read/staff-write RLS and revalidation on save. ⛔ *Nav menu manager, USP strip, collection spotlight and store locations deferred*
- [x] **Settings** — `store_settings` single row driving free-shipping threshold, flat rate, tax and store info (read by `create_order`); staff accounts, roles and the sign-up allowlist
- [x] **Audit log** — 21+ mutations write actor, machine action, entity and summary. Append-only by construction: staff hold SELECT and no write policy at all. `actor_email` denormalised so records survive user deletion

**Exit criteria:** ✅ met — the client can run the store day-to-day without a developer.

---

### Phase 4 — Shipping: EasyParcel Integration
**Status: ✅ built — awaiting EasyParcel credentials to exercise live**
**Duration: ~1 week** — *client feature #4* · *commits `f6cfe85`, `dbf7172`, `c018843`, `931ca7e`*

> **⚠️ Scope corrected mid-phase after client clarification: customers do not choose a courier.**
> Checkout charges the store flat rate (or free above the threshold), computed server-side exactly
> as before. EasyParcel exists so Kalima can book a parcel, get the AWB and print a label from the
> order page instead of re-typing an address on easyparcel.com. The `shipping_quotes`
> freeze/redeem layer built for the checkout picker was **removed** — it exists to stop an
> untrusted browser choosing its own shipping price, and there is no untrusted party in an
> admin-only flow.

- [ ] EasyParcel account + API key — ⛔ **client action, still outstanding** (§8). The code is complete and unexercised against the live API.
- [x] ~~**Checkout:** live rate quotes~~ → **out of scope by design** (see box above). Variant weights *were* added to the catalog as an inline, audit-logged field in the variant editor, since couriers price on weight
- [x] **Admin:** "Book with EasyParcel" on a pending parcel — rates load cheapest-first, staff pick a courier, booking writes back AWB, courier, cost and weight and advances a paid order to fulfilled. The picker states plainly that the figures are Kalima's own wallet cost, not a customer price
  - **Idempotency:** the shipment row is claimed with a conditional update (`pending → booked`) *before* the API call, so a second concurrent click loses the race instead of booking a second parcel and debiting the wallet twice. A failed call releases the claim
  - **Wallet pre-check:** an empty wallet produces "top up", not a raw upstream error, and costs nothing
  - **OAuth connect/callback:** `state` carries no identity and proves only that the round trip began in this browser; identity is re-derived from the staff session in the callback. *The reference integration encoded the user id in `state`, which let an attacker attach their own merchant account to someone else's store and receive their shipments.*
  - ⛔ *Bulk booking across multiple orders not built — one parcel at a time*
- [x] **Tracking:** `/api/shipping/webhook` consumes EasyParcel status pushes. EasyParcel publishes no HMAC scheme, so auth is a shared secret compared in constant time and **fails closed** — no secret in the environment means every request is rejected (503). An unmapped upstream status is ignored rather than written through; a `delivered` push only completes an order that is paid or fulfilled, so a refunded order is never silently promoted. Responses are 200 even on failure so EasyParcel stops retrying. ⛔ *Shipped-notification email not wired*
- [x] Storefront order history shows courier + a working tracking link, resolved from a per-courier URL template (an explicit URL from a booking always wins)
- [x] Edge cases: Malaysian state names mapped to ISO 3166-2 (`Selangor → MY-10`) because EasyParcel prices on the code and a wrong one silently misprices West vs East Malaysia — 12 unit tests cover aliases, ISO passthrough, unknown → null and East Malaysia classification. Top-up-needed surfaced by the wallet pre-check. ⛔ *Oversized-item handling not built*

**Exit criteria:** ⛔ **not yet met** — needs a real parcel booked, labelled and tracked to delivery, which requires the client's EasyParcel account. Everything up to that boundary is verified: settings save with audit entries, the webhook rejects no-secret / wrong-secret / same-length-wrong-value with 401 (constant-time compare confirmed), accepts the correct secret via header, alternate header and query fallback, and a full push sequence rewrote the AWB, ignored an unknown status and moved paid → completed on delivery.

### Phase 4b — Courier choice for Malaysian orders (EasyStore-style checkout)
**Status: 🟡 built 26 Aug 2026 — migration on staging; needs EasyParcel connected on staging to exercise, then production**

> Reverses the Phase 4 scope decision at the client's request: Malaysian shoppers now pick a courier
> at checkout from live EasyParcel **pickup** rates and pay that courier's price at cost, exactly as
> overseas already did. The zone rate is not deleted — it is a **mode**.

- [x] `store_settings.domestic_shipping_mode` = `zone` | `courier` (migration `20260826030000`). Admin › Shipping › "What customers pay" has the switch; saving `courier` is refused unless EasyParcel is connected, so a checkout can never be left unable to price itself
- [x] `price_order` sends Malaysia through the frozen-quote path in courier mode (`shipping_by_courier` in the result); the free-shipping code and spend threshold still win. Zone mode is byte-for-byte the old behaviour. `shop_public_settings()` exposes the mode so the checkout knows whether to show the list
- [x] Checkout: courier list appears automatically once a Malaysian postcode (5 digits) + state are filled in, debounced 600 ms, cheapest first, re-quoted on address/cart change; "Place order" is blocked until one is picked. **Pickup services only** on both the checkout and the admin picker — the shop never uses drop-off
- [x] Admin booking picker pre-selects the service the customer paid for (chip "Customer's choice") and warns when that service is no longer offered for the parcel. Booking polls EasyParcel three times for the AWB before returning, so most bookings land with the AWB and label already
- [x] **J&T only for Malaysia** (client decision 26 Aug): `store_settings.domestic_allowed_couriers` (migration `20260826040000`, default `{J&T}`), editable in Admin › Shipping as a comma-separated list, matched case-insensitively against courier/service names; blank = all pickup couriers. With one option the checkout pre-selects it. Overseas is not filtered. Verified on staging: Selangor address → J&T Express (Pick Up) RM6.49, auto-selected
- [x] **Overseas limited to Ninja Van, Aramex, UPS, DHL** (client decision 26 Aug): `store_settings.international_allowed_couriers` (migration `20260826050000`), same matching and admin field as the domestic list
- [x] One-click booking: an order with no parcel shows "Book with EasyParcel" directly; it creates the pending parcel and opens the picker (`createPendingParcel`). Services with a minimum parcel count ("DHLeC (Pick Up with min 3 parcel(s))") are filtered out — one order is one parcel
- [x] OAuth callbacks (EasyParcel and Meta channels) redirect back to the host the request came from; the hardcoded `localhost:3000` fallback sent a successful staging connection to a dead page
- [x] **Live on staging, 26 Aug:** EasyParcel connected; order KLM-10272-31F69A placed with live Selangor pickup rates (Pos MELPlus RM5.90 … cheapest first), Best Express RM6.53 frozen and charged; admin picker pre-selects it. **Stopped before Confirm booking** — a real booking schedules a courier pickup at the warehouse
- [x] **Real booking verified 26 Aug 2026** on staging against the live API: KLM-10272 → J&T (Pick Up) booked, EasyParcel ref `ES-2608-6CYA6`, AWB `632143239945`, A6 label URL returned within the booking call's poll, RM6.04 debited; order → fulfilled. Then **cancelled from the order page** (new "Cancel booking" action, two clicks) → parcel `cancelled`, order back to `paid`, wallet credit pending courier confirmation. Audit log carries created → booked → cancelled. Pickup address + phone were blank on both projects until the client filled them in — a booking cannot succeed without them
- [x] Migrations `…030000/040000/050000` applied to **production** by hand and the ledger aligned; `main` fast-forwarded and deployed. Production remains in **zone** mode until the switch is flipped in Admin › Shipping
- [ ] Tracking push → `completed` still unexercised (the test parcel was cancelled before collection) — watch the first genuine booking
- [ ] Two catalogue weights still 0 g: Tiaraa Top (all variants) and one Maya Caftan variant — they quote at the 0.5 kg default until filled in
- [ ] Not built: shipped-notification email/WhatsApp on booking; bulk booking; per-courier hide list

---

### Phase 5 — Customer Messaging & Bulk Broadcast
**Status: ✅ email and WhatsApp done**
**Duration: ~1–2 weeks** — *client feature #1* · *commit `9dd4198`*

> **Both channels work.** Meta Business verification cleared on 5 August 2026 and the WhatsApp
> broadcast arm landed on 20 August. The `campaigns` and `campaign_recipients` tables were built
> **channel-agnostic** from the start (`campaign_channel` already carried `whatsapp`), and that paid
> off exactly as intended — WhatsApp slotted in without reshaping either table.
>
> What still gates a *send* is per-template approval, which is Meta's to give and arrives per
> template rather than once. See [INSTRUCTION.md §2.8](./INSTRUCTION.md).

- [x] **WhatsApp Business Cloud API** setup — verification cleared 5 Aug 2026; live on the test number
- [x] **Template management** — synced from Meta rather than authored here, because Meta owns approval. `whatsapp_templates` is a write-locked cache; **Sync templates** in `/admin/inbox` refreshes it and prunes templates deleted upstream. Media-header templates are filtered out of the picker rather than offered and rejected. ⛔ *Authoring/submission stays in Meta Business Manager, deliberately*
- [x] **WhatsApp broadcasts** — template + positional bindings instead of a body, audience resolved by **phone** against `profiles.marketing_consent`, deduped per number. Sequential with a larger pause than the email path: tripping WhatsApp's rate limit marks the number's quality rating down, which is slow to undo
- [x] **WhatsApp opt-out** — no unsubscribe link exists in a chat, so `STOP` / `berhenti` / `unsubscribe` is read out of the inbound webhook into `whatsapp_opt_outs`, keyed by phone because most senders have no account. Matched only as a **whole message** — *"don't stop making these in navy"* must not unsubscribe anyone. An opt-out also clears `marketing_consent`, so it stops the email list too
- [x] **Audience segments** — ⛔ *tags dropped in favour of behavioural filters*: buyers-only, minimum lifetime spend, active-within-N-days, inactive-for-N-days. Consent status is not a filter — see PDPA below
- [x] **Campaign composer** — subject + body, pick segment, live audience count, send
- [x] **Send pipeline** — sends are **sequential with a pause**, not parallel: a broadcast that trips Resend's rate limit half way through is worse than a slower one. The campaign is claimed `draft → sending` before the first message so a double click cannot mail the list twice. Every message writes a `campaign_recipients` row, so the delivery report is the log rather than a guess. ⛔ *Read receipts not available on the email path*
- [x] **Transactional WhatsApp** (built 26 Aug 2026) — three automations, *Payment confirmed* / *Parcel on its way* / *Delivered*, each mapped in Admin › Inbox › "Automatic messages" to an approved template and switched on individually (`whatsapp_automations`, migration `20260826060000`, applied to staging and production). Values are positional and fixed per event and listed beside the picker — {{1}} first name, {{2}} order reference, then total + items / courier + tracking number + link — so the template is written at Meta against that contract; a template wanting more values than the event offers cannot be chosen. Fired from the paid transition (`runPaidSideEffects`), EasyParcel booking, hand-recorded parcels, and the shipping webhook; **exactly once per order and event** via a claim row in `whatsapp_automation_sends`, which is also the send log (sent / failed / skipped with reason). Opt-outs are honoured; phones are normalised to wa_id (0123… → 60123…). Each send is recorded on the customer's inbox thread so a reply lands in context. **Live on production 26 Aug (afternoon):** the channel was moved off Meta's test number onto the real +60 11-4570 4489 (new system-user token with both WhatsApp scopes, phone id `1333755213149079`, WABA `994756373576493`); `kalima_payment_confirmed` approved and the *Payment confirmed* automation switched on; `kalima_order_shipped` submitted and pending — switch *Parcel on its way* on once Sync shows it approved. *Delivered* deliberately left off (per-message cost). `/api/channels/whatsapp/diagnose` (staff-only) reports what the token, phone id and WABA id resolve to, because Vercel keeps those values sensitive and unreadable
- [x] **Email campaigns** — Resend broadcast off the same segment engine, fed by the footer "Join Kalima Club" list. *This also fixed a live untruth: that form showed a success message and persisted nothing — it told people they had joined a list that did not exist.*
- [x] **PDPA compliance** — treated as **the floor, not a filter option**. `resolveAudience` always excludes anyone without explicit consent and anyone who has unsubscribed, and there is deliberately **no switch to override it** — compliance should not be one careless checkbox away. Consent is timestamped with its source; unsubscribing is *recorded*, not deleted, so a later import cannot resurrect someone who said no. Every marketing email carries a per-subscriber random unsubscribe token (so a link cannot be forged from someone else's address) plus `List-Unsubscribe` headers. Marketing mail uses a separate shell from the transactional templates: this one must carry an unsubscribe link and a receipt must not. The subscriber table has **no read policy** for `anon` or `authenticated` — an open select would hand every customer email to a scraper

**Costs to flag to client:** Meta charges per marketing conversation (~RM0.30–0.60 range, category-dependent) — billed to client's Meta account.

**Exit criteria:** 🟡 **partially met.** The pipeline is verified end to end — signup persists with timestamped consent and a 48-char token; unsubscribe works, is idempotent and rejects a forged token; the audience preview returned 5 (4 consenting accounts + 1 active subscriber) with the opted-out address excluded, narrowing to 4 under the buyers filter. **No campaign has actually been sent**, deliberately: the seed audience is real-looking gmail.com addresses and sending would put mail in a stranger's inbox. The client's first real broadcast closes this out.

---

### Phase 6 — Affiliate Program
**Status: ✅ done**
**Duration: ~1–2 weeks** — *client feature #2* · *commits `36da292`, `dace8e8`*

- [x] **Affiliate onboarding** — application form creates a **pending** row, never an approved one; self-approval would make every downstream fraud guard pointless. Pending/suspended affiliates see a status message rather than a dashboard implying earnings
- [x] **Codes & links** — per-affiliate discount code (e.g. `AISYAH10`) + trackable link (`kalima.my/?ref=aisyah`). The `?ref` is captured by the proxy into a 30-day httpOnly cookie and stamped onto the order **after** creation — deliberately a follow-up update rather than a `create_order` parameter, because attribution is bookkeeping layered on the sale and must never be able to fail the sale
- [x] **Attribution engine** — runs when an order becomes **paid**, from the payment webhook, so an abandoned or failed order never earns anyone a commission. Commission is integer sen computed server-side from the order, on **goods after discount, excluding shipping and tax** — postage the store merely passes through is not margin to pay out on. Per-affiliate rate in basis points (default 10%)
- [x] **Clawback** — wired into `refund_order` itself rather than added as a second path a caller could forget: refunding a referred sale kills its commission in the same transaction that returns the stock
- [x] **Affiliate portal** (`/affiliate`) — referral link, discount code, and earnings split into **Held vs Payable**, because "when do I actually get paid" is the question the page exists to answer. ⛔ *Click/conversion stats and marketing asset downloads not built*
- [x] **Admin** — approve/suspend, per-affiliate commission rate, attach a discount code, record a payout with a DuitNow reference. **The payout control has no amount field**: the server settles exactly the referrals past their hold period and derives the total from them, because a typed amount could disagree with the ledger and the ledger has to win. Balances are **derived** from `affiliate_referrals`, never stored on the affiliate row
- [x] **Fraud guards — all in the database, not the UI:**
  - **Self-purchase:** an affiliate buying through their own code or link earns nothing. Matched on `user_id` **and** on email, because signing out is not a loophole
  - **One per order:** `unique(order_id)` means the code path and the link path can never both pay for the same sale. An explicit code beats an ambient cookie
  - **Hold period:** 14 days, so a refund lands before money goes out rather than after
  - **Approved only:** a pending or suspended affiliate accrues nothing

**Exit criteria:** ✅ met — verified against the database: link attribution 20000 → 2000 sen; code attribution (30000−3000) → 2700 sen with shipping excluded; self-purchase blocked; pending affiliate earns nothing; re-running attribution idempotent; an order carrying both a code and a ref produced exactly one referral; refunding flipped it to `clawed_back`. An approved affiliate on 12% showed Held RM48 / Payable RM30, and recording a payout settled only the cleared RM30.

---

### Phase 7 — Loyalty & Membership ("Kalima Club")
**Status: ✅ done**
**Duration: ~1–2 weeks** — *client feature #3* · *commits `5d6c002`, `4df3240`, `c5851ea`*

- [x] **Points engine** — RM1 = 1 point, awarded on order **completion**, not payment: goods still inside the return window are a liability that may have to be unwound, and handing points out then clawing them back is a worse experience than a short wait. A unique index on `(order_id) where type='earn'` makes a replayed completion a no-op, so the shipping webhook's delivery push cannot re-award. Balance is the sum of unexpired ledger entries — earning positive, redemption and expiry negative. 12-month expiry
- [x] **Redemption at checkout** — happens **inside `create_order`'s transaction**, not as a follow-up call: if the order fails to insert the points are not spent, and if it succeeds they cannot be spent twice. A separate "burn points" call would leak points on failure or double-spend on retry. The caller says *how many* points to use, never *what they are worth* — the amount is clamped by three independent limits (the customer's real ledger balance, the scheme's per-order ceiling, and what is left to pay), so no combination of inputs can produce a negative total or spend points that do not exist. Hitting the cap leaves the remainder in the balance rather than burning it. Defaults: 100 points = RM5, 100-point minimum, 50% of order maximum
- [x] **Tiers** — Member / Gold (RM1,000) / Platinum (RM3,000) by 12-month spend, with 1× / 1.5× / 2× earn multipliers and free shipping at Platinum. Tier is **recomputed on read**, never stored, so it can never be stale after a refund; refunded orders are excluded, because a sale that came back should not keep buying status. ⛔ *Early-access gated pages and birthday vouchers not built (the latter depends on Phase 5 WhatsApp)*
- [x] **Storefront** — `/kalima-club` shows balance, what it is worth, tier progress and history when signed in, and works as a scheme explainer when signed out. Points teaser on the PDP. Checkout shows a Club panel: points held, what redeeming saves, the discount summary line, and what the order will earn — the panel mirrors the server's clamp so the figure shown is the figure charged, but it is a **preview, not a decision**: a tampered client can misdraw it and never change the price. 🟡 *The `/account` Club card is still the old hardcoded mock-up — `/kalima-club` is the real view*
- [x] **Admin** — liability report leading with **outstanding liability**, because unredeemed points are money already promised; computed from the ledger and floored at zero per member so a negative balance cannot quietly reduce what is owed. Rules and tiers displayed. ⛔ *Manual point adjustments and tier overrides are DB-only — no UI*
- [x] **Refund reversal** — deducts what was *actually awarded* rather than recomputing, because rules or tier may have changed since, and balance is allowed to go negative — the alternative is letting someone refund their way to free points
- [x] Tie-in: newsletter signup band upgraded to a real, consent-recording Club list (Phase 5)

> **Two real bugs this phase found and fixed.**
> 1. Points reversal had been wired into the admin refund *action*, but `refund_order` is the actual money path and is also reached from the LeanX refund webhook — so a gateway-initiated refund returned the stock and clawed back the commission while silently **destroying** the points the customer had spent. Stock, commission and points now all reverse inside the one function.
> 2. **A points-farming loop.** `award_loyalty_points` based earning on `subtotal − discount` and ignored `loyalty_discount_sen`, so a customer earned points on the portion they had paid for *with points* — redeem, earn on the redemption, feed it back. Slow, but real. Earning now applies only to money actually paid for goods.

**Exit criteria:** ✅ met — RM200 of goods earned 200 points with shipping excluded; replaying the award returned "already awarded"; crossing RM1,000 promoted to Gold and the next order earned 150 for RM100 at 1.5×; a revoke took 350 → 200 and a second revoke did not double-deduct. Redemption verified by attacking each limit: 999,999 points against a 500 balance used 500; 5,000 points on an RM89 order capped at exactly 50% and charged only 890; 50 points against a 100-point minimum redeemed nothing; a guest requesting 5,000 redeemed nothing. Refunding an order that spent 890 points returned them (4110 → 4610).

---

### Phase 8 — Marketplace Stock Sync (Shopee + TikTok Shop)
**Status: 🟡 engine built and verified — Shopee/TikTok HTTP adapters await app approval**
**Duration: ~2–3 weeks** — *client feature #5*

> **Everything that does not depend on a vendor's API contract is built, verified and live.**
> Shopee and TikTok have issued no credentials and publish no sandbox reachable without one, so
> their HTTP clients are deliberate stubs behind the `ChannelAdapter` seam in
> `src/lib/channels/`. When a credential lands, the remaining work is one adapter file rather
> than a feature — the same approach Phase 4 groundwork took with EasyParcel.
>
> ⚠️ **The platform applications were meant to start during Phase 3 and STILL have not been
> submitted.** 1–4 weeks of approval each, and they are now the only thing between this engine
> and a working sync (§8).
>
> Note that "Edge Function queue" below means a Next route handler on a Vercel cron; the project
> uses no Supabase Edge Functions (§4.1).

- [ ] **Platform apps** — ⛔ **client action, outstanding.** `channel_connections` is built and
      sealed (RLS on, no policies, explicit revoke — service-role only), and the staff-gated OAuth
      connect/callback routes are live at `/api/channels/[channel]/{connect,callback}`. `state`
      carries no identity; identity is re-derived from the staff session.
- [x] **SKU mapping** — `/admin/sync` maps variants to marketplace listings, with a per-listing
      safety buffer, a pause switch, and an unmapped report driven by lines that actually arrived
      in marketplace orders. Bulk mapping is by **seller-centre CSV import matched on SKU only** —
      fuzzy-matching a product name would silently point a listing at the wrong variant, and every
      future push would then be wrong in both directions.
- [x] **Outbound sync** — an `AFTER INSERT` trigger on `stock_movements` enqueues a push for every
      mapped listing, so all five stock paths are covered rather than five call sites anyone could
      forget. Jobs carry **no quantity** — they are an intent to resync, which is what lets a
      partial unique index collapse rapid movements into one push. Drained by `/api/channels/sync`
      on a once-a-minute Vercel cron, claiming with `for update skip locked`, exponential backoff
      to six attempts. *Pushes themselves no-op until an adapter exists.*
- [x] **Inbound sync** — `/api/channels/[channel]/webhook` verifies the signature through the
      adapter (fail-closed: an unwired adapter returns false, never true) and calls
      `record_channel_sale`, which is idempotent on `(channel, external_order_id)` and decrements
      through the ledger with `origin_channel` set as a loop guard. ⛔ *The 15-minute
      reconciliation poll is not built — it needs an adapter to poll against.*
- [x] **Marketplace orders visibility** — imported into `channel_orders`, shown on `/admin/sync`.
      Deliberately **not** in `orders`: both platforms mandate their own fulfilment and refunds, so
      an imported row could never be shipped or refunded here, and keeping it separate means
      `refund_order`, `award_loyalty_points` and `attribute_referral` cannot reach it.
- [x] **Conflict policy** — website DB is the source of truth. Per-listing safety buffer honoured
      by one shared, unit-tested quantity rule. Oversell is **clamped, not refused**:
      `stock_on_hand` carries `check (>= 0)` and a marketplace sale has already happened, so the
      decrement is capped at what we hold, `applied_qty` records the shortfall, and an `oversell`
      is logged at level `error`.
- [x] **Sync health dashboard** — queued/running/failed counts, per-channel connection state with
      the real reason a channel is unavailable, unmapped report, recent marketplace orders, and a
      live activity log. Manual re-sync goes through the same debounced queue so pressing it cannot
      stampede a rate limit.
- [x] **Usable before any approval** — CSV export of per-listing quantities using the same rule the
      automated push will use, so the manual and automatic paths can never disagree. With the
      listing import, that completes a working loop today: seller centre → import mappings → export
      stock → bulk upload.

**Exit criteria:** ⛔ **not yet met** — needs a real sale on one channel to move stock on the other
two, which requires the platform apps. Everything up to that boundary is verified: the trigger fires
on all five stock paths, 11 rapid movements collapse to one job per channel, the loop guard holds in
both directions, two concurrent workers claim 20 jobs with zero overlap, backoff escalates to
'failed' at six attempts, `record_channel_sale` is idempotent and clamps an oversell, both endpoints
fail closed, and the CSV export honours the safety buffer exactly.

---

### Phase 9 — Unified Inbox (Shopee / TikTok / Instagram / WhatsApp)
**Status: 🟡 engine built and verified — channel adapters await Meta/Shopee/TikTok approval**
**Duration: ~2–3 weeks** — *client feature #6, the client's headline priority* · scope per feasibility matrix (§3)

> **Everything that does not depend on a vendor's API contract is built and live — and WhatsApp,
> Instagram and Facebook are now connected.** The schema, ingestion route, reply-window
> enforcement, customer linking, notes, canned replies and the three-pane admin all work against
> the real database, with live traffic on them since 5 August 2026.
>
> ⚠️ **Shopee and TikTok remain unapplied for**, and Instagram/Facebook still need Meta App Review
> before they can message the *public*. WhatsApp was the shortest path exactly as predicted: it
> shared the Meta Business verification Phase 5 broadcasts already needed, and one application
> opened both.
>
> "Edge Functions" below means Next route handlers (§4.1).

- [ ] **Channels in scope** — ⛔ **client action, outstanding for every one.** Shopee chat ·
      TikTok Shop buyer chat · TikTok organic DMs (Business Messaging, 48h window) · Instagram DM
      and Facebook Page (post Meta App Review) · WhatsApp (shares Phase 5's Meta verification) ·
      TikTok *personal/creator* DMs have no API anywhere and do not apply to a Business account.
- [x] **Ingestion** — `/api/channels/[channel]/messages/webhook` normalizes into
      `conversations`/`messages`, idempotent on `external_message_id` so a redelivery cannot
      double-post or inflate the unread count. Signature checking is delegated to the adapter and
      **fails closed**; the subscription handshake refuses too, so no live webhook can be pointed
      at the app before it can handle the traffic. ⛔ *Media is stored as sent for now — mirroring
      bytes into Storage needs a wired adapter to know what auth their CDN requires.*
- [x] **Inbox UI** — three panes: thread list with channel badges and unread counts, the
      conversation, and the customer's orders and Kalima Club standing beside it. Filters by
      channel; assignment and open/snoozed/closed status. ⛔ *Supabase Realtime is not wired —
      threads refresh on navigation. It is new ground in this codebase and deserves its own change
      once there is live traffic to test against.*
- [x] **Replies** — the reply window is enforced **server-side**, computed from `last_inbound_at`
      by a unit-tested module and re-derived again inside the send path, because a page rendered an
      hour ago can show an open composer for a window that has since closed. Outside it the
      free-text box is disabled and states the reason. Per-channel hours are data, not a hardcoded
      number: 24h Meta, 48h TikTok Business, none on Shopee.
- [x] **Templates** (WhatsApp) — the other side of the same rule. Outside the window Meta accepts
      only a pre-approved template, so the composer gains a Template tab with **no free-text box**:
      the wording was approved as a whole and only the `{{n}}` slots are editable, with a live
      preview that leaves an unfilled slot visibly `{{n}}` rather than blank. Approval status is
      re-read from the cache on every send, never trusted from the client — a composer rendered ten
      minutes ago may be offering a template Meta has since paused. Every template send is audited
      with its name, unlike a free reply, because it is billed and policy-governed.
      ⛔ *Media-header templates are filtered out; supplying the media needs the Storage work above.*
- [x] **Opt-out** — `STOP`/`berhenti`/`unsubscribe` read out of the inbound webhook into
      `whatsapp_opt_outs`, keyed by phone because most senders have no account. Whole-message match
      only: *"don't stop making these in navy"* must not unsubscribe anyone.
      ⛔ *A plainly-worded "please stop sending me these" is not caught and needs a human — see
      [INSTRUCTION.md §2.9](./INSTRUCTION.md).*
- [x] **Team features** — assignment, open/snoozed/closed, internal notes and canned replies.
      A note is a message DIRECTION, not a flag, so it cannot reach a customer through any code
      path; five starting replies are seeded and editable.
- [ ] **Meta App Review** — ⛔ **outstanding**, for `instagram_business_manage_messages` and
      `pages_messaging` (2–4 weeks). WhatsApp does not need it and comes first.

**Exit criteria:** ✅ **met for WhatsApp** — a real message from a Malaysian phone appeared in
`conversations` about four seconds after sending, on 5 August 2026. Still ⛔ for Shopee and TikTok,
which need their approvals.

Verified below that boundary: inbound recording links a customer by phone and by email, a
redelivered message id changes nothing, an outbound reply does not extend the reply window, a note
does not advance the thread, both webhook entry points fail closed, and the admin renders an open
window, a closed window and a no-window channel correctly.

⚠️ **Two links have still never been proven end to end**, and neither needs code or an approval —
only a phone: that an admin reply *arrives*, and that an internal note *does not*. See
[INSTRUCTION.md §2.7](./INSTRUCTION.md) steps 5–6. The second is the dangerous one: a note that
leaks looks identical to a note that worked, until a customer replies to it.

---

### Phase 10 — QA, SEO, Performance & Launch
**Status: ⛔ not started**
**Duration: ~1–2 weeks**

> Also outstanding and worth folding in here: **no CI pipeline, no automated test suite, and a
> single Supabase project with no staging/prod split.** Verification to date is live-database
> manual testing recorded per commit — `git log` is currently the most accurate test report.

- [ ] Full regression: purchase flows (FPX/e-wallet), refunds, all integrations end-to-end
- [ ] Load/perf: Lighthouse ≥ 90 mobile, image lazy-loading audit, bundle-size budget
- [ ] SEO: meta/OG per page, product structured data (JSON-LD → Google rich results), sitemap, canonical URLs. *The SSR/prerender decision is already resolved — the Next.js migration made PDP/PLP server-rendered and statically prerendered with hourly ISR*
- [ ] Analytics events wired: view_item, add_to_cart, begin_checkout, purchase (GA4 + Meta + TikTok pixels)
- [ ] Security pass: RLS audit, webhook signature verification (payment/Shopee/TikTok/Meta/EasyParcel), rate limiting, secrets rotation
- [ ] PDPA: privacy policy, consent records, data export/delete procedure
- [ ] Backups & monitoring: Supabase PITR, uptime monitor, error tracking (Sentry), alert channel to client WhatsApp/email
- [ ] Launch runbook: DNS cutover to `kalima.my`, go-live checklist, 2-week hypercare
- [ ] Admin training session + recorded walkthrough videos (BM/EN)

---

## 7. Timeline Summary

| Phase | Scope | Duration | Cumulative | Status |
|---|---|---|---|---|
| 0 | Foundations | 1 wk | Wk 1 | ✅ done |
| 1 | Storefront UI | 2–3 wk | Wk 4 | ✅ done |
| 2 | Commerce core | 2–3 wk | Wk 7 | ✅ done |
| 3 | Admin dashboard | 2–3 wk | Wk 10 | ✅ done |
| 4 | EasyParcel | 1 wk | Wk 11 | ✅ built — blocked on client credentials |
| 5 | Messaging/broadcast | 1–2 wk | Wk 13 | ✅ email and WhatsApp done |
| 6 | Affiliate | 1–2 wk | Wk 15 | ✅ done |
| 7 | Loyalty/membership | 1–2 wk | Wk 17 | ✅ done |
| 8 | Shopee + TikTok sync | 2–3 wk | Wk 20 | 🟡 engine built — apps still not applied for |
| 9 | Unified inbox | 2–3 wk | Wk 23 | 🟡 engine built — approvals still not applied for |
| 10 | QA & launch | 1–2 wk | **Wk 24–25 (~6 months full scope)** | ⛔ not started |

**Where the project actually is:** phases 0–7 are delivered — roughly week 17 of the plan, i.e. the
build is on schedule against its own sequence. **Everything still outstanding is either an
external approval or a launch task**, not further feature work on 0–7.

**Recommended go-live strategy (unchanged, and now actionable):** the store can already sell and
ship — soft-launch is gated on three things, none of which are development:
1. EasyParcel account + API key (Phase 4 cannot be exercised live without it)
2. Domain + DNS cutover for `kalima.my`
3. Phase 10 launch tasks — SEO, analytics, monitoring, backups, admin training

Phases 5 (WhatsApp), 8 and 9 then roll out as post-launch upgrades on the live store, which is
exactly what the platform approval lead times want anyway.

> ⚠️ **The Phase 8/9 platform applications were supposed to start during Phase 3 and have not been
> submitted.** At 1–4 weeks of approval each, every week they are delayed pushes those phases back
> one-for-one. Submitting them now costs nothing and de-risks the post-launch roadmap.

> Durations assume one dedicated full-stack developer + designer support. Parallelizing with 2 devs compresses to roughly 4 months.

---

## 8. Third-Party Accounts & Prerequisites (Client Action Items)

**These are now the critical path.** Development on phases 0–7 is complete; what remains is
almost entirely waiting on the items below.

| Item | Needed by | Status | Notes |
|---|---|---|---|
| `kalima.my` domain access | Phase 0 | ⛔ **outstanding** | DNS management. Blocks go-live. |
| SSM business registration docs | Phase 2 | ✅ done | Used for gateway KYC |
| Payment gateway account | Phase 2 | ✅ **done — LeanX live** | Resolved from the Stripe/toyyibPay/Billplz question. FPX + e-wallets working end to end. |
| EasyParcel account + API key + credit top-up | Phase 4 | ⛔ **outstanding — highest priority** | The integration is code-complete and cannot be exercised without it. Instant-ish to obtain. |
| Meta Business Manager (verified) + WhatsApp number | Phase 5 | ✅ **verified 5 Aug 2026** | Live on the free test number. Remaining: add the production number (one variable — [INSTRUCTION.md §2.7a](./INSTRUCTION.md)) and get one template approved per message you want to broadcast. |
| Shopee seller account + Open Platform app approval | Phase 8 | ⛔ **outstanding — overdue** | Was scheduled for Phase 3; approval 1–4 wks |
| TikTok Shop seller account + Partner Center app approval | Phase 8 | ⛔ **outstanding — overdue** | Was scheduled for Phase 3; approval 1–4 wks |
| Instagram professional account linked to Facebook Page | Phase 9 | ⛔ outstanding | Needed for IG DM + Messenger API + Meta App Review |
| TikTok **Business** account + Business Messaging API access | Phase 9 | ⛔ outstanding | Confirmed: Kalima's TikTok is a Business account. Register for Business Messaging API credentials + authorize the account to our app |
| Product photography & copy (per mockup art direction) | Phase 1 | 🟡 partial | 7 model shots across 5 SKUs wired in; remaining catalog items render branded placeholders until shots are supplied |
| Policies content: returns (14-day), shipping, privacy (PDPA) | Phase 2/10 | 🟡 partial | Content pages are live and CMS-editable; final policy copy still to be reviewed |

---

## 9. Risks & Open Questions

### Risks
1. **⬆️ ESCALATED — Platform approvals are the critical path** for Phases 8–9, and **the applications have still not been submitted** (they were planned for Phase 3, now long past). Each carries 1–4 weeks of review outside our control. Mitigation still holds — the soft-launch strategy keeps them non-blocking for revenue — but the delay is now pure schedule loss on the post-launch roadmap.
2. **⬆️ NEW — Client action items are the only thing between here and launch.** Development on phases 0–7 is done. EasyParcel credentials, DNS access and Meta verification are all outstanding, and no amount of engineering moves them.
3. **⬆️ NEW — No CI, no automated tests, one Supabase project.** Every change to date was verified by manual testing against the live database and recorded in the commit message. That has worked well and caught real bugs, but it does not scale to hypercare, and there is no staging environment to rehearse a release in. Mitigation: fold a test suite + staging project into Phase 10.
4. **TikTok DM coverage depends on account type** — Kalima's TikTok is a **Business** account, so both TikTok *Shop* buyer chat and **organic TikTok DMs** (via the Business Messaging API) are inboxable. Only TikTok *personal/creator* DMs have no API anywhere, and that does not apply here. No client-facing gap on TikTok.
5. **WhatsApp broadcast costs & quality rating** — aggressive blasts can degrade the WABA quality score and throttle sending. Mitigation: consent-gated segments (already enforced at the database level, with no override switch), frequency caps.
6. **Marketplace stock race conditions** — flash-sale moments can oversell across channels. Mitigation: ledger constraints (already in place) + per-channel safety buffer + oversell alerts.
7. ~~**SPA SEO**~~ — **✅ RESOLVED.** The Next.js App Router migration made the storefront server-rendered, with PDP/PLP/content routes prerendered at build time and revalidated hourly. No prerender service needed.

### Open questions for client

1. ~~**Brand palette conflict**~~ — **Resolved.** Kalima Navy `#383C61` + white, extracted from the logo files (§2.1.1), applied as ink throughout.
2. ~~**Free-shipping threshold** — RM300 or RM500?~~ — **Resolved by making it configurable.** The threshold, flat rate and tax live in `store_settings` and are editable at `/admin/settings` without a deploy; `create_order` reads them. *Small follow-up: the checkout free-shipping **display** still uses the client-side default — the charged total is already server-authoritative.* Regional (West/East MY) tiering is still not built if the client wants it.
3. ~~**Payment gateway preference**~~ — **Resolved: LeanX** (FPX + e-wallets), live and webhook-confirmed.
4. ~~**Affiliate commission structure**~~ — **Resolved as built:** flat percentage per affiliate, stored in basis points with a 10% default and a per-affiliate override, plus a 14-day hold period. Payouts are manual DuitNow with a reference recorded against the settled referrals. *Open: payout cadence — weekly, monthly, or on request?*
5. ~~**Loyalty economics**~~ — **Resolved as built defaults**, all editable in `loyalty_rules` without a deploy: RM1 = 1 point, 100 points = RM5, 100-point minimum redemption, 50% of order maximum, 12-month expiry; tiers Member / Gold (RM1,000) / Platinum (RM3,000) at 1× / 1.5× / 2× with free shipping at Platinum. *Client to confirm these are the numbers they want to launch with — outstanding points are a real liability.*
6. **Languages** — still open. English-only at launch, or BM + EN? i18n was not built and would now be a Phase 10 addition.
7. **Physical store list** for the Stores locator page — still open; `store_locations` was never built.
8. **NEW — Birthday vouchers and tier early-access** were specified in Phase 7 but not built (the voucher path depends on WhatsApp). Confirm whether these are launch scope or a later upgrade.

---

*This document is the master build reference. Each phase begins with a kickoff confirming scope and ends with a staging demo + client sign-off before the next phase starts.*

*Reconciled against the codebase on 3 August 2026 (branch `refactor/nextjs-shadcn-supabase`, 30 migrations applied, `tsc --noEmit` clean). Where this document and the code disagree, the code wins — and the commit messages are the most detailed record of what was built and how it was verified. See also [README.md](./README.md) for the developer-facing view and its Known gaps section.*
