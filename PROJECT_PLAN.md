# KALIMA.MY — E-Commerce Platform Build Plan

**Project:** Kalima — Timeless Modest Luxury (kalima.my)
**Type:** Custom e-commerce storefront + admin back-office (EasyStore-class features, self-hosted)
**Stack:** React.js (Vite + TypeScript) · Supabase (Postgres, Auth, Storage, Edge Functions, Realtime)
**Market:** Malaysia (MYR, BM/EN, FPX-first payments, EasyParcel logistics)
**Prepared by:** Nexova Digital
**Date:** 17 July 2026

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

**Why custom (React + Supabase) instead of a hosted platform:** full ownership of customer data (critical for messaging/loyalty/affiliate features), no monthly platform fees or transaction fee lock-in, and freedom to integrate any Malaysian service (EasyParcel, toyyibPay, Shopee, TikTok) without app-store limitations.

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
11. **Trust footer bar** — 4 icon columns: Free Shipping (orders above RM500 — ⚠️ mockup inconsistency vs RM300 announcement bar, confirm threshold) · Easy Returns (14-day policy) · Secure Payment · Customer Support.
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

| # | Client request | Feasibility | Approach | Phase |
|---|---|---|---|---|
| 1 | Message / bulk message to customers | ✅ Fully feasible | WhatsApp Business Cloud API (template broadcasts) + transactional email (Resend). Segmented audiences from our own customer DB. | 5 |
| 2 | Affiliate code | ✅ Fully feasible | Native build: unique codes + referral links, click & order attribution, commission ledger, payout tracking, affiliate portal. | 6 |
| 3 | Loyalty / membership | ✅ Fully feasible | Native build: points ledger, tier system ("Kalima Club": e.g. Member/Gold/Platinum), earn on purchase, redeem at checkout, birthday rewards. | 7 |
| 4 | Link postage to EasyParcel | ✅ Fully feasible | EasyParcel Individual/Marketplace API: live rate quotes at checkout, one-click consignment booking from admin, AWB label PDF, tracking webhooks → auto customer notification. | 4 |
| 5 | Stock sync with Shopee & TikTok Shop | ✅ Feasible (approval-gated) | Shopee Open Platform API + TikTok Shop Open Platform API. SKU mapping table, near-real-time stock push on our sales, webhook-driven stock pull on marketplace sales. Requires developer app approval on both platforms (lead time). | 8 |
| 6 | Read TikTok / IG / Shopee messages in one place | ✅ Feasible (approval-gated) | **Shopee:** ✅ chat API via Open Platform. **TikTok Shop:** ✅ customer-service conversation API for approved apps. **TikTok organic DMs:** ✅ **Business Messaging API** — Kalima's TikTok account is a Business account, which unlocks send/receive of organic TikTok DMs (48h reply window). **Instagram + FB Page:** ✅ via Meta's Messenger API for Instagram — requires Meta App Review + IG professional account linked to a FB Page. **WhatsApp:** ✅ Cloud API (already integrated in Phase 5). Only gap: TikTok *personal/creator* DMs (no API on any platform) — not relevant here, since Kalima runs a Business account. | 9 |

**Honest summary for the client:** items 1–6 boleh buat semua. Item 6 (unified inbox) covers Shopee chat, TikTok **Shop** buyer chat, **TikTok organic DMs** (Kalima's TikTok is a Business account, so the TikTok Business Messaging API applies), Instagram DM + Facebook Page (lepas Meta approval), and WhatsApp — semua dalam satu inbox, reply terus dari sana. The only thing with no API anywhere is TikTok *personal/creator* DMs, which does not apply to a Business account. This is beyond what EasyStore offers at any tier, and no third-party vendor sells this exact channel mix (see [INTEGRATION_STRATEGY.md §2⑥](./INTEGRATION_STRATEGY.md)).

> **Client priority (confirmed):** the goal is **unification — read and reply to every channel from one place** — not outbound blasting. Broadcast (Phase 5) stays in scope for transactional/opt-in messaging, but Phase 9's inbox is the headline: one screen, every conversation, each linked to the customer's orders and Kalima Club profile.

---

## 4. Technical Architecture

### 4.1 Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **React 18 + Vite + TypeScript** | SPA with route-based code splitting. |
| Styling | **Tailwind CSS** + design tokens | Tokens derived from §2.1 (colors, type scale, spacing). |
| Routing | React Router v7 | Storefront + `/admin` + `/affiliate` portals in one app (role-gated). |
| Server state | TanStack Query | Caching, optimistic updates. |
| Client state | Zustand | Cart drawer, UI state (persisted to localStorage + synced to DB when logged in). |
| Backend | **Supabase** | Postgres 15 + Row Level Security, Auth, Storage (product images), Edge Functions (Deno), Realtime (unified inbox live updates), `pg_cron` (scheduled sync jobs). |
| Payments | **Stripe Malaysia** (FPX + cards + GrabPay) — or **toyyibPay/Billplz** if client prefers lower FPX fees | Decision needed; see §9. Webhook-driven order confirmation. |
| Email | Resend (transactional + campaigns) | Order confirmations, shipping updates, newsletters. |
| WhatsApp | Meta WhatsApp Business Cloud API | Broadcasts (template messages) + transactional notifications. |
| Shipping | EasyParcel API v1 | Rates, booking, AWB, tracking. |
| Marketplaces | Shopee Open Platform v2, TikTok Shop Open Platform | OAuth per shop, webhooks + polling fallback. |
| Hosting | Vercel (frontend) + Supabase Cloud | `kalima.my` apex + `admin` served from same app. |
| Analytics | GA4 + Meta Pixel + TikTok Pixel | Pixel events needed for ads ROI anyway. |

### 4.2 Architecture Principles

- **All secrets & third-party calls live in Supabase Edge Functions** — Shopee/TikTok/EasyParcel/WhatsApp keys never touch the browser.
- **RLS everywhere:** customers see only their own rows; `admin`/`staff` roles via JWT claims; affiliates see only their own referral data.
- **Webhook-first, poll-fallback** for marketplace sync (webhooks can be delayed/dropped; `pg_cron` reconciliation every 15 min).
- **Single inventory source of truth:** `product_variants.stock_on_hand` in Postgres; every change goes through a `stock_movements` ledger (auditable, prevents oversell disputes with marketplaces).
- **Money integrity:** orders/payments state machines (`pending → paid → fulfilled → completed / cancelled / refunded`); payment confirmed **only** by gateway webhook, never by client redirect.

---

## 5. Database Schema (high level)

~35 tables, grouped by domain. Detailed DDL delivered per-phase as Supabase migrations.

**Catalog:** `categories` (tree), `collections`, `products`, `product_variants` (SKU, color, size, price, stock_on_hand), `product_images`, `lookbook_posts` (+ product tags)

**Customers:** `profiles` (extends auth.users; phone in E.164 for WhatsApp), `addresses`, `wishlists`, `newsletter_subscribers`, `customer_tags` (segmentation for broadcasts)

**Commerce:** `carts`, `cart_items`, `orders`, `order_items`, `payments`, `discount_codes`, `discount_redemptions`, `stock_movements` (ledger: sale/restock/adjustment/marketplace_sync)

**Shipping:** `shipping_zones`, `shipments` (EasyParcel consignment no., AWB URL, courier, status), `shipment_tracking_events`

**Messaging (Phase 5):** `message_templates`, `campaigns`, `campaign_recipients`, `message_logs` (per-message delivery status)

**Affiliate (Phase 6):** `affiliates`, `affiliate_clicks`, `affiliate_referrals` (order-level attribution + commission), `affiliate_payouts`

**Loyalty (Phase 7):** `membership_tiers`, `loyalty_ledger` (earn/redeem/expire entries), `loyalty_rules`

**Marketplace sync (Phase 8):** `channel_connections` (Shopee/TikTok OAuth tokens per shop), `channel_listings` (SKU ↔ marketplace item/model ID map), `channel_orders` (imported marketplace orders), `sync_jobs` / `sync_logs`

**Unified inbox (Phase 9):** `conversations` (channel, external thread ID, customer link), `messages` (direction, body, attachments, read state), `inbox_assignments`

**CMS/Settings:** `announcements` (top bar), `hero_slides`, `content_blocks`, `pages`, `store_locations`, `settings`

---

## 6. Build Phases

> ### 🎬 Demo preview build — client walkthrough
> The repo contains a **full clickable demo** of the storefront plus mockups of every client-requested feature, using the supplied model photoshoot for 5 SKUs (Maya Chiffon, Bella Dress, Amanda Sparkle, Ruwa Kaftan, Sofea Dress). Demo screens show sample data with a "Demo preview" badge; each becomes live in its listed phase.
>
> | Route | What the client sees | Phase it goes live |
> |---|---|---|
> | `/` | Full storefront with real photoshoot imagery | 1 |
> | `/checkout` → `/checkout/success` | Checkout w/ EasyParcel live rates, FPX/card/e-wallet, discount & **affiliate code** (try `AISYAH10`), **points redemption**, WhatsApp confirmation story | 2, 4 |
> | `/account` | Kalima Club member dashboard — points, Gold→Platinum tier progress, order history w/ tracking | 2, 7 |
> | `/affiliate` | Affiliate portal — stats, referral link/code, commissions, payouts | 6 |
> | `/admin` | Back-office dashboard — KPIs, 14-day sales chart, channel split | 3 |
> | `/admin/orders` · `/admin/products` · `/admin/customers` | Ops tables w/ marketplace channel badges, stock, tags/consent | 3 |
> | `/admin/campaigns` | **① Bulk messaging** — WhatsApp/email campaigns, segments, template composer w/ preview | 5 |
> | `/admin/affiliates` | **② Affiliate program** management — codes, attribution, payouts | 6 |
> | `/admin/loyalty` | **③ Loyalty/membership** — tiers, earn/redeem rules, liability | 7 |
> | `/admin/shipping` | **④ EasyParcel** — credit, courier quotes, booking, AWB, tracking timeline | 4 |
> | `/admin/sync` | **⑤ Shopee & TikTok stock sync** — connections, SKU mapping, live stock, activity log | 8 |
> | `/admin/inbox` | **⑥ Unified inbox** — Shopee, TikTok Shop + organic DMs, Instagram, WhatsApp threads in one place, quick replies, linked orders | 9 |

### Phase 0 — Foundations & Project Setup
**Duration: ~1 week**

- [x] Repo init (Git) — *done; branch strategy + CI pipeline pending*
- [x] Vite + React + TS + Tailwind v4 + Router v7 + TanStack Query + Zustand scaffolding
- [x] Supabase project + migrations workflow + seed scripts — *live (`gylsymfonxyegdlfodvk`, Singapore); catalog + auth schema applied, `seed.sql` generated from `catalog.ts`. Single production env for now, not staging+prod.*
- [x] Design tokens from §2.1/§2.1.1 in `src/index.css` — Kalima Navy `#383C61` scale, cream/beige surfaces, Playfair Display + Jost pairing, tracked-caps label utility
- [x] Base component library: Button (solid/outline/white), section header, product card w/ swatches, placeholder imagery, 20-icon thin-line set
- [x] Auth skeleton: email/password sign-in, phone capture, roles (`customer`/`staff`/`admin`/`affiliate`) — *done: Supabase Auth + `profiles`, role in JWT `app_metadata`, signup pipeline with an admin allowlist, self-elevation blocked. `/admin` gated on staff/admin, `/account` on any signed-in user. **Google sign-in deferred** (needs a Google OAuth app); magic link not built.*
- [ ] Domain + DNS for `kalima.my`, staging URL

**Exit criteria:** deployed "hello storefront" on staging with auth working and design tokens applied.

---

### Phase 1 — Storefront UI
**Duration: ~2–3 weeks** — pixel-faithful build of the mockup + all implied pages (§2.3).

- [x] **Announcement bar** — rotating messages w/ arrows (admin-editable arrives with Phase 3 CMS)
- [x] **Header + nav** — dropdown menus (WOMEN/MEN/SIGNATURE), sticky on scroll, mobile drawer nav, search overlay (client-side name search; Postgres full-text lands with Supabase)
- [x] **Home page** — hero carousel, category tiles, Maya collection spotlight (arch mask), best-sellers rail, USP strip, lookbook grid, newsletter signup, trust bar, navy footer w/ white logo
- [x] **Product card** — placeholder imagery, wishlist toggle, name, RM price, color swatches w/ image-tone swap on click
- [x] **PLP (category/collection)** — breadcrumb, sort (featured/price); *filter sidebar (size, color, price, fabric) + pagination still to do*
- [x] **PDP** — color/size selection, add-to-bag → cart drawer, accordions (description/fabric/shipping), loyalty points teaser, related products; *stock states + notify-me arrive with real inventory (Phase 2)*
- [x] **Wishlist page** (persisted), **content page stubs** (About, Fabrics, Shipping, Returns, Stores, Kalima Club); *Raya campaign landing template + shoppable lookbook tags still to do*
- [x] Responsive mobile-first layout (hamburger drawer, 2-col grids); *skeleton loaders + image optimization pending real photography*
- [x] **Photography drop-in (partial)** — 7 model shots wired in across 5 SKUs (hero, category tiles, Maya spotlight arch, best sellers, lookbook, PDP, cart), incl. **per-colour variant photos** on Ruwa Kaftan (Peach/Lilac/Powder Blue — swatch click swaps the photo); remaining catalog items render branded placeholders until shots are supplied (§8)
- [x] Cart drawer w/ free-shipping progress bar (RM300 threshold, configurable in `src/stores/cart.ts`)

**Exit criteria:** client walkthrough of complete storefront on staging with seeded catalog (mockup's 5 best-sellers + Maya collection).

---

### Phase 2 — Commerce Core
**Duration: ~2–3 weeks**

- [ ] **Cart** — mini-cart drawer + cart page, guest cart (localStorage) merged into DB cart on login, free-shipping progress bar ("RM xx away from free shipping" — ties to announcement bar)
- [ ] **Checkout** — single-page: contact, address (Malaysian states/postcodes), shipping method (flat rates first; live EasyParcel rates land in Phase 4), discount code field, order summary
- [ ] **Payments** — chosen gateway integration (FPX, card, e-wallet), hosted/redirect flow, **webhook-confirmed** payment status, idempotent order creation, failed/abandoned payment recovery
- [ ] **Orders** — state machine, order confirmation page + email, **stock decrement via `stock_movements`** ledger with oversell guard (`stock_on_hand >= qty` constraint)
- [ ] **Customer account area** — order history w/ status timeline, addresses book, profile, password/phone management
- [ ] **Discount codes** — % / fixed / free-shipping, min spend, usage limits, expiry (foundation reused by affiliate + loyalty phases)
- [ ] Email notifications: order confirmed, payment received (Resend templates in brand style)

**Exit criteria:** end-to-end real test order on staging with RM1 live-mode payment, stock decremented, email received.

---

### Phase 3 — Admin Dashboard
**Duration: ~2–3 weeks** — the EasyStore-replacement back office at `/admin`.

- [ ] **Dashboard** — today/7d/30d sales, orders, AOV, top products, channel breakdown (prepared for Shopee/TT later)
- [ ] **Products** — CRUD, variant matrix editor, image upload w/ drag-sort, inventory adjustments (reasoned, ledger-backed), CSV import/export
- [ ] **Orders** — list w/ filters & search, detail view, manual status updates, refund/cancel (gateway refund API), packing slip print
- [ ] **Customers** — list, profile w/ lifetime value & order history, tags for segmentation (feeds Phase 5 broadcasts)
- [ ] **Discounts** — code management UI
- [ ] **CMS** — announcement bar messages, hero slides, collection spotlight, USP items, nav menu manager (seasonal items like RAYA COLLECTION), pages editor, store locations
- [ ] **Settings** — shipping rates, tax, store info, staff accounts & roles
- [ ] Audit log for admin actions

**Exit criteria:** client can run the store day-to-day without developer help.

---

### Phase 4 — Shipping: EasyParcel Integration
**Duration: ~1 week** — *client feature #4*

- [ ] EasyParcel account + API key (client action, see §8); sandbox first
- [ ] **Checkout:** live rate quotes by postcode + parcel weight (variant weights added to catalog), courier selection or cheapest-auto, free-shipping threshold override
- [ ] **Admin:** one-click "Book shipment" on paid orders → EasyParcel order creation, credit balance check, AWB/label PDF download, bulk booking for multiple orders
- [ ] **Tracking:** consignment status polling/webhook → order timeline updates → customer email (and later WhatsApp) notification "Your order has shipped, track here"
- [ ] Storefront order page shows courier + tracking link
- [ ] Edge cases: East Malaysia rates, oversized items, EasyParcel top-up-needed alerts

**Exit criteria:** real parcel booked, labelled, and tracked through to delivery on a staging order.

---

### Phase 5 — Customer Messaging & Bulk Broadcast
**Duration: ~1–2 weeks** — *client feature #1*

- [ ] **WhatsApp Business Cloud API** setup: Meta Business verification, WABA, phone number, display name (client action, §8)
- [ ] **Template management** — create/submit WhatsApp templates (Meta approval required per template) from admin
- [ ] **Audience segments** — filter customers by tags, purchase history (e.g. "bought Raya 2025 collection", "spent > RM500", "inactive 90 days"), consent status
- [ ] **Campaign composer** — pick template → pick segment → variable mapping (name, voucher code) → schedule/send
- [ ] **Send pipeline** — Edge Function queue with rate limiting, per-message delivery/read status → `message_logs`, campaign report (sent/delivered/read/failed)
- [ ] **Transactional WhatsApp** — order confirmed, shipped w/ tracking (upgrade from email-only)
- [ ] **Email campaigns** — same segment engine → Resend broadcast (newsletter "Kalima Club" list from footer signup)
- [ ] **PDPA compliance** — explicit marketing consent checkbox at signup/checkout, unsubscribe/opt-out handling for both channels

**Costs to flag to client:** Meta charges per marketing conversation (~RM0.30–0.60 range, category-dependent) — billed to client's Meta account.

**Exit criteria:** client sends a real segmented broadcast to test customers and views a delivery report.

---

### Phase 6 — Affiliate Program
**Duration: ~1–2 weeks** — *client feature #2*

- [ ] **Affiliate onboarding** — application form → admin approval → affiliate role
- [ ] **Codes & links** — unique discount code per affiliate (e.g. `AISYAH10`) + trackable link (`kalima.my/?ref=aisyah`, 30-day cookie); either path attributes the order
- [ ] **Attribution engine** — order webhook records `affiliate_referrals` row w/ commission (% or fixed, per-affiliate override), only on **paid** orders; clawback on refund/cancel
- [ ] **Affiliate portal** (`/affiliate`) — dashboard: clicks, orders, conversion, pending/approved/paid commission, marketing asset downloads
- [ ] **Admin** — affiliate list, commission rules, payout batching (mark-as-paid w/ reference no. — DuitNow transfer done manually by client; payout automation optional later)
- [ ] Fraud guards: self-purchase block, code+link double-attribution rules, commission hold period (e.g. 14 days = return window)

**Exit criteria:** test affiliate earns, sees, and gets marked paid for a commission end-to-end.

---

### Phase 7 — Loyalty & Membership ("Kalima Club")
**Duration: ~1–2 weeks** — *client feature #3*

- [ ] **Points engine** — earn rule (e.g. RM1 = 1 point) applied on order **completion** (after return window), ledger-based balance, expiry policy (e.g. 12 months)
- [ ] **Redemption** — points → discount at checkout (e.g. 100 pts = RM5), min/max redemption rules
- [ ] **Tiers** — e.g. Member / Gold / Platinum by 12-month spend; perks: point multipliers, early access to collections (gated pages), birthday voucher (auto-issued via Phase 5 WhatsApp/email), free shipping tier
- [ ] **Storefront** — account "Kalima Club" page: balance, tier progress bar, history, available rewards; points preview on PDP/checkout ("Earn 295 points")
- [ ] **Admin** — rules config, manual point adjustments, tier overrides, liability report (outstanding points value)
- [ ] Tie-in: newsletter signup band (§2.2 #10) upgraded to full Club signup

**Exit criteria:** customer earns points on a paid order, redeems on the next, tier upgrades automatically.

---

### Phase 8 — Marketplace Stock Sync (Shopee + TikTok Shop)
**Duration: ~2–3 weeks** — *client feature #5* · ⚠️ start platform app applications during Phase 3 (approval lead time 1–4 weeks)

- [ ] **Platform apps** — register on Shopee Open Platform & TikTok Shop Partner Center (client authorizes their shops via OAuth; tokens stored encrypted in `channel_connections`)
- [ ] **SKU mapping** — admin UI to link Kalima variants ↔ Shopee item/model IDs ↔ TikTok SKU IDs (auto-match by SKU string + manual override); unmapped-listing report
- [ ] **Outbound sync (site sale → marketplaces)** — on our stock change, push new qty to both platforms via Edge Function queue (debounced, retried, logged)
- [ ] **Inbound sync (marketplace sale → site)** — Shopee/TikTok order webhooks decrement `stock_on_hand` via ledger; `pg_cron` reconciliation poll every 15 min as safety net
- [ ] **Marketplace orders visibility** — imported into `channel_orders`, shown in admin orders list with channel badge (fulfilment stays in Shopee/TikTok seller centers — they mandate their own logistics)
- [ ] **Conflict policy** — website DB is source of truth; oversell alarm if marketplace sells below safety stock; optional per-channel stock buffer (e.g. hold back 2 units)
- [ ] **Sync health dashboard** — last sync per channel, error queue, manual re-sync button

**Exit criteria:** a sale on any of the 3 channels updates stock on the other 2 within ~1 minute (webhook path) / 15 min worst case (poll path).

---

### Phase 9 — Unified Inbox (Shopee / TikTok / Instagram / WhatsApp)
**Duration: ~2–3 weeks** — *client feature #6, the client's headline priority* · scope per feasibility matrix (§3)

> **This is the "reply to everyone from one place" feature.** The client's focus is
> unification and response, not outbound blasting — every incoming message from every
> channel lands in one screen, each linked to the customer's orders and Kalima Club
> profile, and staff reply without leaving the admin.

- [ ] **Channels in scope:** Shopee chat ✅ · TikTok **Shop** buyer chat ✅ · **TikTok organic DMs** ✅ (Business Messaging API — Kalima runs a TikTok **Business** account, 48h reply window) · Instagram DM ✅ (post Meta App Review) · Facebook Page messages ✅ (same Meta track) · WhatsApp ✅ (infra already exists from Phase 5) · TikTok *personal/creator* DMs ❌ (no API anywhere — not applicable to a Business account)
- [ ] **Ingestion** — per-channel webhook receivers (Edge Functions) normalize messages into `conversations`/`messages`; media attachments mirrored to Storage
- [ ] **Inbox UI (admin)** — 3-pane layout: conversation list w/ channel badges & unread counts, thread view, reply composer; Supabase Realtime for live updates; filters by channel/assignee/unread; link conversation → customer profile & orders
- [ ] **Replies** — send back through each channel's API (Shopee `send_message`, TikTok Shop CS reply, TikTok Business Messaging send, IG/Messenger send, WhatsApp send). Respect per-channel reply windows: IG/FB 24h, TikTok Business 48h, WhatsApp 24h + template fallback. Outside the window the composer disables free-text and surfaces the reason
- [ ] **Team features** — assign conversation to staff, internal notes, canned replies/quick answers ("What's my order status?" → auto-context from linked order)
- [ ] **Meta App Review** submission for `instagram_business_manage_messages` + `pages_messaging` (allow 2–4 weeks; feature ships Shopee + TikTok-first, Meta channels toggled on when approved)

**Exit criteria:** messages from a test buyer on Shopee, TikTok Shop, TikTok organic DM, and Instagram all appear in one inbox and receive replies from it — each thread linked to the sender's customer record.

---

### Phase 10 — QA, SEO, Performance & Launch
**Duration: ~1–2 weeks**

- [ ] Full regression: purchase flows (FPX/card/e-wallet), refunds, all integrations end-to-end
- [ ] Load/perf: Lighthouse ≥ 90 mobile, image lazy-loading audit, bundle-size budget
- [ ] SEO: meta/OG per page, product structured data (JSON-LD → Google rich results), sitemap, canonical URLs; pre-rendering/SSR for PDP/PLP if crawlability requires (Vite SSR or prerender service — decide during phase)
- [ ] Analytics events wired: view_item, add_to_cart, begin_checkout, purchase (GA4 + Meta + TikTok pixels)
- [ ] Security pass: RLS audit, webhook signature verification (payment/Shopee/TikTok/Meta/EasyParcel), rate limiting, secrets rotation
- [ ] PDPA: privacy policy, consent records, data export/delete procedure
- [ ] Backups & monitoring: Supabase PITR, uptime monitor, error tracking (Sentry), alert channel to client WhatsApp/email
- [ ] Launch runbook: DNS cutover to `kalima.my`, go-live checklist, 2-week hypercare
- [ ] Admin training session + recorded walkthrough videos (BM/EN)

---

## 7. Timeline Summary

| Phase | Scope | Duration | Cumulative |
|---|---|---|---|
| 0 | Foundations | 1 wk | Wk 1 |
| 1 | Storefront UI | 2–3 wk | Wk 4 |
| 2 | Commerce core | 2–3 wk | Wk 7 |
| 3 | Admin dashboard | 2–3 wk | Wk 10 |
| 4 | EasyParcel | 1 wk | Wk 11 |
| 5 | Messaging/broadcast | 1–2 wk | Wk 13 |
| 6 | Affiliate | 1–2 wk | Wk 15 |
| 7 | Loyalty/membership | 1–2 wk | Wk 17 |
| 8 | Shopee + TikTok sync | 2–3 wk | Wk 20 |
| 9 | Unified inbox | 2–3 wk | Wk 23 |
| 10 | QA & launch | 1–2 wk | **Wk 24–25 (~6 months full scope)** |

**Recommended go-live strategy:** soft-launch after **Phase 4 (~week 11)** — store can sell and ship. Phases 5–9 roll out as post-launch upgrades on the live store. This gets revenue flowing ~3 months earlier and lets marketplace app approvals (Phase 8/9 blockers) run in parallel.

> Durations assume one dedicated full-stack developer + designer support. Parallelizing with 2 devs compresses to roughly 4 months.

---

## 8. Third-Party Accounts & Prerequisites (Client Action Items)

| Item | Needed by | Notes |
|---|---|---|
| `kalima.my` domain access | Phase 0 | DNS management |
| SSM business registration docs | Phase 2 | Required for payment gateway KYC |
| Payment gateway account (Stripe MY / toyyibPay / Billplz) | Phase 2 | KYC approval ~3–10 working days |
| EasyParcel account + API key + credit top-up | Phase 4 | Instant-ish; marketplace API needs request form |
| Meta Business Manager (verified) + WhatsApp number | Phase 5 | Business verification can take 1–3 weeks — **start early**. Number must not be attached to a personal WhatsApp. |
| Shopee seller account + Open Platform app approval | Phase 8 | Apply during Phase 3; approval 1–4 wks |
| TikTok Shop seller account + Partner Center app approval | Phase 8 | Apply during Phase 3; approval 1–4 wks |
| Instagram professional account linked to Facebook Page | Phase 9 | Needed for IG DM + Messenger API + Meta App Review |
| TikTok **Business** account + Business Messaging API access | Phase 9 | Confirmed: Kalima's TikTok is a Business account. Register for Business Messaging API credentials + authorize the account to our app |
| Product photography & copy (per mockup art direction) | Phase 1 | Warm-tone studio style; 4:5 product shots + lookbook |
| Policies content: returns (14-day), shipping, privacy (PDPA) | Phase 2/10 | We provide templates for review |

---

## 9. Risks & Open Questions

### Risks
1. **Platform approvals are the critical path** for Phases 8–9 (Shopee/TikTok/Meta reviews are outside our control). Mitigation: apply during Phase 3; soft-launch strategy makes these non-blocking.
2. **TikTok DM coverage depends on account type** — Kalima's TikTok is a **Business** account, so both TikTok *Shop* buyer chat and **organic TikTok DMs** (via the Business Messaging API) are inboxable. Only TikTok *personal/creator* DMs have no API anywhere, and that does not apply here. No client-facing gap on TikTok.
3. **WhatsApp broadcast costs & quality rating** — aggressive blasts can degrade the WABA quality score and throttle sending. Mitigation: consent-gated segments, frequency caps.
4. **Marketplace stock race conditions** — flash-sale moments can oversell across channels. Mitigation: ledger constraints + per-channel safety buffer + oversell alerts.
5. **SPA SEO** — client-rendered React can underperform for organic search. Mitigation: Phase 10 prerender/SSR decision for PDP/PLP.

### Open questions for client
1. ~~Brand palette conflict~~ **Resolved:** brand colors extracted from logo files — Kalima Navy `#383C61` + white (§2.1.1). Remaining sign-off: client to approve navy-as-ink (headings/buttons/nav) on the mockup's cream surfaces, replacing the mockup's near-black.
2. **Free-shipping threshold** — RM300 (announcement bar) or RM500 (footer)? Or tiered by region (West/East MY)?
3. **Payment gateway preference** — Stripe (best DX, ~3% cards / RM1 FPX) vs toyyibPay/Billplz (cheaper FPX, weaker card/e-wallet support)?
4. Commission structure for affiliates (flat % vs tiered?) and payout cadence?
5. Loyalty economics — earn rate, redemption value, tier thresholds? (We'll propose defaults in Phase 7 kickoff.)
6. Languages — English-only at launch, or BM + EN (i18n adds ~1 week to Phase 1)?
7. Physical store list for the Stores locator page?

---

*This document is the master build reference. Each phase begins with a kickoff confirming scope and ends with a staging demo + client sign-off before the next phase starts.*
