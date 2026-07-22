# Kalima — Integration Strategy: Build vs Buy

**Decision needed before Phase 2+:** for the six admin feature modules, do we integrate platform APIs
directly (build), subscribe to third-party services (buy), or mix? Target: **equal or better power than
EasyStore's Business package**, at a defensible monthly cost, with feature robustness.

*Researched July 2026 · FX assumption USD 1 ≈ RM4.30 · verify quotes before signing — SaaS pricing moves.*

---

## 1. The Benchmark: EasyStore Business

| Plan | Price | Notes |
|---|---|---|
| EasyStore Standard | RM249/mo | Baseline store |
| **EasyStore Business** | **RM499/mo** | 10 staff, 5 sales channels, 25 app integrations |
| EasyStore Growth | RM899/mo | |

Source: [EasyStore pricing](https://www.easystore.co/en-my/pricing) · [StoreStarter breakdown](https://storestarter.co/best-ecommerce-platform/easystore-pricing/)

**Key insight:** even at RM499/mo, EasyStore does **not** natively include a unified Shopee/TikTok/IG/WhatsApp
inbox, a full affiliate engine, or WhatsApp bulk messaging — those are add-on apps and usage fees on top.
Matching "EasyStore Business power" is a lower bar than it sounds; our target is to **exceed** it.

---

## 2. Feature-by-Feature: Options & Costs

### ① Bulk messaging (WhatsApp/email)

| Option | Fixed cost | Usage cost | Notes |
|---|---|---|---|
| **Build: Meta WhatsApp Cloud API direct** ✅ | RM0 platform fee | Marketing **RM0.3467/msg**, utility **RM0.0564/msg**, service replies **free**; billed in MYR since Apr 2026 | Per-message pricing since Jul 2025. Our demo admin UI already models this. Needs Meta Business verification + template approval. |
| Buy: respond.io | Starter $79/mo (~RM340), Growth $159/mo (~RM684) annual billing | Same Meta fees **plus** Monthly-Active-Contact overages + extra seats ($20/seat) | Polished tooling, but MAC-based costs stack. |
| Buy: SleekFlow | Pro AI $149/mo (~RM640, 2,000 contacts), Premium $349/mo (~RM1,500) | Same Meta fees + MAC model | |
| Email side | Resend/similar ~US$20/mo (~RM86) | — | Needed in all scenarios. |

**Verdict: build.** The Cloud API has no platform fee — a BSP subscription mostly re-sells UI we've already
designed. 2,000 marketing messages/month ≈ RM693 usage either way.

Sources: [Meta pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) · [MYR rates](https://whautomate.com/whatsapp-business-api-pricing-malaysia) · [respond.io pricing](https://respond.io/pricing) · [SleekFlow pricing](https://sleekflow.io/pricing)

### ② Affiliate program

| Option | Cost | Notes |
|---|---|---|
| **Build: native on Supabase** ✅ | RM0/mo | Codes, links, attribution, ledger, portal — fully designed in Phase 6 plan + demo UI. We own the data; ties into our own checkout natively. |
| Buy: GoAffPro Premium | $24/mo (~RM103) | Cheap, has API, but Shopify-centric — custom-site integration is the awkward path. |
| Buy: Tapfiliate Launch | $74/mo (~RM318) | Proper REST API + JS pixel for custom sites; 50 affiliates/5k clicks caps. |

**Verdict: build.** Attribution must hook our checkout anyway; a SaaS adds a monthly fee for a smaller feature
set than the plan already specifies (fraud holds, clawbacks, DuitNow payout tracking).

Sources: [GoAffPro](https://goaffpro.com/) · [Tapfiliate pricing](https://www.capterra.com/p/145773/Tapfiliate/)

### ③ Loyalty / membership (Kalima Club)

| Option | Cost | Notes |
|---|---|---|
| **Build: native ledger on Supabase** ✅ | RM0/mo | Points/tiers/expiry per Phase 7 plan. |
| Buy: Voucherify / Open Loyalty | API-call-based / enterprise quotes (typically hundreds of USD/mo) | API-first engines aimed at enterprise composable stacks. Overkill. |
| (Smile.io etc.) | — | Shopify-ecosystem only — not usable on our custom store. |

**Verdict: build — no contest.** The SMB loyalty SaaS market is platform-locked; the API-first ones are
enterprise-priced. A ledger table + rules is well within scope.

Sources: [Voucherify](https://www.voucherify.io/loyalty-software) · [Open Loyalty](https://www.openloyalty.io/)

### ④ Shipping (EasyParcel)

| Option | Cost | Notes |
|---|---|---|
| **Build: EasyParcel API direct** ✅ | **API free**; pay per shipment via prepaid credit (typical ~RM5–9 West MY parcel) | Official Individual/Marketplace API: rate check, order booking, AWB, tracking, credit balance, **webhooks**. Free to test. |

**Verdict: build (only option — and it's free).** EasyParcel *is* the third party; there is no cheaper aggregator layer worth adding.

Source: [EasyParcel developers](https://developers.easyparcel.com/) · [API landing](https://easyparcel.com/my/apilanding/)

### ⑤ Stock sync — Shopee + TikTok Shop

| Option | Fixed cost | Notes |
|---|---|---|
| Build: Shopee Open Platform + TikTok Shop APIs direct | RM0/mo | Free official APIs. **Cost is time + approval lead (1–4 wks each)** + ongoing webhook/reconciliation maintenance (our Phase 8 design). |
| **Buy: BigSeller** ✅ (bridge) | **Free plan**: 3 stores, 1,500 orders/mo, real-time Shopee/Lazada/TikTok sync. **Basic RM129/mo** adds MyInvois e-Invoice (LHDN) compliance. Pro ~RM304/mo eq. | MY-focused ERP, priced in RM. Custom-website connection possible via API key + webhook after their review. Includes marketplace **chat console**. |
| Buy: SiteGiant ERP | ERP Mini RM100/mo (1,500 orders; Lazada+Shopee) | MY vendor; MultiChat free from ERP Mini up. Ecosystem geared to their own webstore though. |
| Buy: Zetpy | Basic RM99/mo eq (RM1,188/yr) → Pro RM299/mo eq | MY vendor; syncs Shopee/TikTok/Lazada/Zalora; Multichat is a paid add-on; custom-store link via their connectors/API. |

**Verdict: start with BigSeller (free → RM129), migrate to direct APIs in Phase 8 if the client wants zero
subscription.** BigSeller's free tier de-risks day one; MyInvois compliance at RM129 is a real bonus for a
Malaysian business. Direct APIs remain the end-state for a single source of truth in our Postgres.

Sources: [BigSeller MY pricing](https://www.bigseller.com/blog/articleDetails/4643/erp-tools-cost-malaysian-sellers.htm) · [BigSeller sync](https://www.bigseller.com/blog/articleDetails/4512/inventory-shopee-lazada-tiktok-shop-malaysia.htm) · [SiteGiant pricing](https://sitegiant.my/pricing/) · [Zetpy pricing](https://www.zetpy.com/pricing/)

### ⑥ Unified inbox (Shopee · TikTok Shop + organic DMs · Instagram · Facebook · WhatsApp)

> **This is the client's headline priority.** The ask is *unification and reply from one place*,
> not outbound blasting — every incoming message, every channel, one screen, linked to the
> customer's orders and Kalima Club profile. Broadcast (①) stays for opt-in transactional
> messaging, but the inbox is what the client actually wants to buy.

**Channel coverage is now complete for Kalima's setup.** The client's TikTok is a **Business account**,
which unlocks the **TikTok Business Messaging API** (send/receive organic TikTok DMs, 48h reply window) on
top of TikTok *Shop* buyer chat. Combined with Shopee chat, Instagram + Facebook Page (Meta Messenger API),
and WhatsApp, every channel the client uses has an **official** API. The only thing with no API anywhere —
TikTok *personal/creator* DMs — does not apply to a Business account.

**Critical market gap (still true):** the polished Western omnichannel tools (respond.io, SleekFlow) cover
WhatsApp/IG/FB/TikTok Business Messaging — **but none integrate Shopee chat.** Only SEA marketplace ERPs
(BigSeller chat, Ginee Chat, SiteGiant MultiChat, Zetpy Multichat) unify Shopee/Lazada/TikTok Shop buyer
chats, and those don't do IG/WhatsApp well and aren't linked to our order data. **No single vendor covers
Kalima's exact mix** (Shopee + TikTok Shop + TikTok organic + IG + FB + WhatsApp, order-linked). "One inbox"
across all of it means our native Phase 9 build on official APIs — nothing off the shelf reaches it.

| Option | Cost | Coverage |
|---|---|---|
| **Build: native (Phase 9)** ✅ | RM0/mo | Shopee chat API + TikTok Shop CS API + **TikTok Business Messaging API** + IG/Messenger (Meta review) + WhatsApp — all in OUR inbox, linked to orders/customers. TikTok *personal* DMs excluded (no API anywhere; N/A for a Business account). |
| Buy: BigSeller/Ginee/Zetpy chat | Included/add-on in sync plan | Marketplace chats ✓, but IG/WhatsApp weak or absent, no TikTok organic DMs, not linked to our order data. |
| Buy: respond.io / SleekFlow | RM340–1,500/mo | WhatsApp/IG/TikTok Business messaging ✓, **Shopee ✗** — and priced for broadcast automation the client isn't asking for. |

**Verdict: build native Phase 9.** It is the only way to get *every* channel in one order-linked inbox, it
fits the client's reply-focused (not blast-focused) goal, and it carries no monthly fee. The sync tool's chat
console (① BigSeller, already in the stack) can bridge marketplace chats on day one while our Shopee/TikTok/Meta
app approvals clear.

Sources: [respond.io channels](https://respond.io/integrations) · [Ginee Chat](https://chrome.google.com/webstore/detail/ginee-chat-multi-messenge/cjglhjhlfmjmdjfkllnhapkddfamabpb) · [Zetpy Multichat](https://www.zetpy.com/multichat/)

---

## 3. Three Strategy Bundles (fixed monthly cost)

| | **A — Build-first** (end state) | **B — Hybrid bridge** ✅ recommended | **C — SaaS-max** (least code) |
|---|---|---|---|
| Broadcasts ① | Meta Cloud API direct — RM0 | Meta Cloud API direct — RM0 | respond.io Growth ~RM684 |
| Affiliate ② | Native — RM0 | Native — RM0 | GoAffPro ~RM103 |
| Loyalty ③ | Native — RM0 | Native — RM0 | Native — RM0 (no viable SaaS) |
| Shipping ④ | EasyParcel direct — RM0 | EasyParcel direct — RM0 | EasyParcel direct — RM0 |
| Stock sync ⑤ | Shopee/TikTok APIs — RM0 | **BigSeller Free→Basic — RM0–129** | BigSeller Basic RM129 |
| Inbox ⑥ | Native Phase 9 — RM0 | BigSeller chat bridge → native later | respond.io (no Shopee!) + BigSeller chat |
| Email | Resend ~RM86 | Resend ~RM86 | Resend ~RM86 |
| **Fixed total** | **~RM86/mo** | **~RM86–215/mo** | **~RM1,000+/mo** |
| Build effort | Highest (Phases 5–9 full) | Medium (Phases 5–7 + light glue) | Lowest |
| Data ownership | Total | Total | Split across vendors |
| vs EasyStore Business RM499 | −83% | −57% to −83% | +100%, still no Shopee-inclusive inbox |

**Usage costs (identical in every bundle — these are the real variable):**

| Usage item | Rate | Example month |
|---|---|---|
| WhatsApp marketing broadcast | RM0.3467/msg | 2,000 msgs = RM693 |
| WhatsApp utility (order/shipping notices) | RM0.0564/msg | 1,000 msgs = RM56 |
| WhatsApp service replies (inbox) | Free | RM0 |
| EasyParcel shipments | ~RM5–9/parcel (passed to customer above threshold) | 300 parcels ≈ RM2,100, mostly recovered via shipping fees |
| Payment gateway | ~1.5–3% per transaction | Scales with revenue |

---

## 4. Recommendation

**Adopt Bundle B now, graduate to Bundle A.**

1. **Native forever (build once, RM0/mo):** loyalty, affiliate, WhatsApp broadcasts on Meta Cloud API,
   EasyParcel. These four either touch our checkout/database so deeply that SaaS is awkward (loyalty,
   affiliate), or the direct API is literally free with no SaaS value-add (Meta, EasyParcel).
2. **BigSeller as the marketplace bridge (RM0 free tier → RM129/mo):** immediate Shopee+TikTok stock sync
   and a marketplace chat console from day one, while our Shopee/TikTok Open Platform app approvals
   (1–4 weeks, outside our control) grind through. MyInvois e-invoicing at RM129 is a compliance bonus
   EasyStore charges more to match.
3. **Native unified inbox in Phase 9 is the client's headline feature** — the ask is reply-from-one-place,
   not blasting. **Nobody sells the client's exact channel mix** (Shopee + TikTok Shop + TikTok organic DMs +
   IG + Facebook + WhatsApp, order-linked). Our build is the only way to get it, and it links every
   conversation to orders and Kalima Club profiles, which no external tool can. Kalima's TikTok Business
   account means even organic TikTok DMs are in scope via the Business Messaging API.
4. **Skip respond.io/SleekFlow** — they're priced for broadcast automation the client isn't asking for
   (~RM640–1,500/mo) and still miss Shopee entirely.

**Bottom line for the client:** fixed platform costs of **~RM86–215/month** (vs EasyStore Business RM499 + apps),
full data ownership, and features EasyStore can't offer at any tier — an order-linked unified inbox spanning
Shopee, TikTok Shop **and** organic TikTok DMs, Instagram, Facebook and WhatsApp (the client's headline ask),
plus loyalty/affiliate engines on the store's own database. The main variable cost is WhatsApp *outbound*
usage (~RM0.35/marketing message) — but since the client's priority is inbound reply, not blasting, most
inbox traffic is inbound and free-to-receive; service replies within the window carry no per-message fee.

## 5. Robustness requirements (apply to whichever bundle)

- Official APIs only (Shopee Open Platform, TikTok Shop Partner, Meta Cloud API, EasyParcel) — no scrapers/unofficial bridges; those get accounts banned.
- Webhook-first with polling reconciliation (15 min) for anything stock- or payment-related; ledgered stock movements (already in the plan).
- Every vendor chosen must have an exit path: BigSeller → direct APIs (Phase 8) is designed in from day one; SKU mapping table is ours, not theirs.
- PDPA: consent captured at our checkout, enforced in our broadcast segments — never upload customer lists to third parties beyond what a send requires.
- Start Meta Business verification + Shopee/TikTok developer applications **now** — they're the critical path (1–4 weeks), not the code.
