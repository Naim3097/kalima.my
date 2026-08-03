# Connecting the Unified Inbox

How to take `/admin/inbox` from "built but no channels" to live messages, one platform at a time.

**Everything on the Kalima side is already built.** The schema, ingestion route, reply-window
enforcement, customer linking, notes, canned replies and the three-pane admin all work against the
real database. What is missing for each platform is two things:

1. **An approval** — every platform gates messaging behind a review you must apply for.
2. **An adapter** — one file in `src/lib/channels/`, implementing five methods.

Nothing else in the codebase changes when a channel comes online.

> ### ✅ WhatsApp's adapter is already written
> `src/lib/channels/meta.ts` implements it: signature verification, the subscription handshake,
> payload parsing and sending. 34 unit tests cover the parts that do not need the network, and the
> full route was exercised with a signed payload end to end into the database.
>
> **What is left for WhatsApp is credentials, not code.** Work through §0 and §2.1–2.2, set the
> five `META_*` variables, press **Connect WhatsApp** in the admin, and it is live. Instagram,
> Facebook, Shopee and TikTok still need their adapters written.

> **Read this first.** This guide is accurate about *Kalima's* side, because that is in this repo.
> For the platforms' side it gives you the path, the vocabulary and the gotchas — but **every
> endpoint path, parameter name and signature scheme must be read from the vendor's current docs at
> implementation time.** These APIs change without notice, and this project has already lost a
> debugging cycle to a guessed field name (LeanX's bank label turned out to live under `name`, not
> the documented `payment_service_name`). Treat any specific API shape below as a hint, not a fact.

---

## Contents

- [0. Do these first](#0-do-these-first-they-block-everything)
- [1. How a channel plugs in](#1-how-a-channel-plugs-in)
- [2. WhatsApp](#2-whatsapp--start-here) ← start here
- [3. Instagram DM](#3-instagram-dm)
- [4. Facebook Page](#4-facebook-page)
- [5. Shopee Chat](#5-shopee-chat)
- [6. TikTok](#6-tiktok-shop-chat--business-messaging)
- [7. Order of attack](#7-order-of-attack)
- [8. Troubleshooting](#8-troubleshooting)

---

## 0. Do these first (they block everything)

| # | Item | Why it blocks |
|---|---|---|
| 1 | **DNS cutover for `kalima.my`** | Every platform requires a **public HTTPS** webhook URL. `localhost` is rejected by all of them, and none accept an IP. Until the domain resolves to the deployed app, no webhook can be registered anywhere. |
| 2 | **Deploy to production** | The URL you register must actually respond. A preview URL works for testing but changes on every deploy, and re-registering a webhook on each push is not a workflow. |
| 3 | **`NEXT_PUBLIC_APP_URL=https://kalima.my`** in Vercel | OAuth callbacks build absolute redirect URLs from it. Unset, it falls back to `http://localhost:3000` and will bounce a merchant to localhost mid-connection. |
| 4 | **Meta Business verification** | Gates WhatsApp, Instagram *and* Facebook. Takes 1–3 weeks. It is also required for the Phase 5 broadcast feature, so this one application unblocks two features. **Start it today** — it is the longest pole. |

Your webhook URLs will be:

```
https://kalima.my/api/channels/<channel>/messages/webhook    ← messages (this guide)
https://kalima.my/api/channels/<channel>/webhook             ← marketplace orders (Phase 8)
https://kalima.my/api/channels/<channel>/callback            ← OAuth return
```

where `<channel>` is one of `whatsapp`, `instagram`, `facebook`, `shopee`, `tiktok`.

---

## 1. How a channel plugs in

### 1.1 The five methods

Each platform gets one file implementing `ChannelAdapter` (`src/lib/channels/types.ts`). The
messaging half is five methods:

| Method | Job | Must never |
|---|---|---|
| `configured()` | `true` when this platform's env vars are set **and** the adapter is implemented | return `true` while the body is still a stub |
| `authUrl(state)` | Where to send the merchant to authorise | put identity in `state` — see §1.3 |
| `exchangeCode(code)` | Swap the callback code for tokens | return a token pair without an absolute `expiresAt` |
| `verifySubscription(params)` | Echo the platform's handshake challenge | return a value it did not actually verify |
| `verifyWebhook(rawBody, headers)` | Authenticate an inbound push | **return `true` on error** — it must fail closed |
| `parseMessageWebhook(body)` | Normalise the payload into `InboundMessage[]` | throw on a payload with no messages — return `[]` |
| `sendMessage(input)` | Deliver a reply | re-check the reply window; that is decided upstream |

`src/lib/channels/meta.ts` is a **worked example** — WhatsApp is fully implemented there, and its
signature and handshake helpers are shared with Instagram and Facebook. `shopee.ts` and `tiktok.ts`
are still stubs that document what their implementations need.

### 1.2 Everything else is already wired

Once `configured()` returns `true` and the methods work:

- `/admin/inbox` lists threads, filters by channel, shows unread counts
- inbound messages are recorded idempotently on `external_message_id` (redeliveries are free)
- customers auto-link on first contact by **E.164 phone** or **email**
- the reply window is computed and enforced server-side
- notes, canned replies, assignment and open/snoozed/closed all work

### 1.3 Two rules the code already enforces — do not undo them

**Fail closed.** An unwired adapter returns `false` from `verifyWebhook` and `null` from
`verifySubscription`. That is deliberate: this handler writes customer conversations on the
service-role client, so an endpoint that accepted unsigned payloads would let anyone inject messages
that reach your staff as genuine enquiries — a convincing phishing surface aimed at the people who
can issue refunds. **Never** stub `verifyWebhook` to `true` "just to test".

**`state` carries no identity.** It proves only that the OAuth round trip started in this browser.
Identity is re-derived from the staff session in the callback. The EasyParcel reference integration
documents an earlier version that encoded a user id in `state`, which let an attacker attach their
own merchant account to someone else's store.

### 1.4 The raw body

Every platform signs the **exact bytes it sent**. The route reads `await request.text()` *before*
any JSON parse and hands that string to `verifyWebhook`. If you re-serialise parsed JSON, key order
and whitespace change and every signature fails. `src/lib/payments/leanx.ts` hashes the raw body for
the same reason.

### 1.5 Reply windows

Already encoded in `REPLY_WINDOW_HOURS` (`src/lib/channels/types.ts`):

| Channel | Window after the customer's last inbound message |
|---|---|
| WhatsApp | 24 h |
| Instagram | 24 h |
| Facebook | 24 h |
| TikTok Business | 48 h |
| Shopee | none |

Outside the window the composer is disabled and the send path refuses. If a platform changes its
rule, change the number here — nothing else reads it.

---

## 2. WhatsApp — start here

**Why first:** it needs only Meta Business verification, which you need for Phase 5 broadcasts
anyway. It does **not** need App Review (unlike Instagram and Facebook), so it is the shortest path
to a working inbox — and it is the highest-volume channel for a Malaysian brand.

### 2.1 What to obtain

1. **Meta Business Manager**, business-verified.
2. **A Meta app** (Business type) at [developers.facebook.com](https://developers.facebook.com) →
   add the **WhatsApp** product.
3. **A WhatsApp Business Account (WABA)** and a **phone number**.
   ⚠️ The number **must not** be attached to a personal WhatsApp account. If it is, delete that
   account first and wait — this trips people up constantly.
4. From the app dashboard: **App ID**, **App Secret**, **Phone Number ID**, **WABA ID**, and a
   permanent **System User access token**.

### 2.2 Environment variables

All five are in `.env.example`. The adapter reports itself configured only when **all** of them are
set — a partial set would produce a channel that accepts messages it cannot answer.

```bash
META_APP_ID=
META_APP_SECRET=            # also the webhook signing key — see 2.4
META_REDIRECT_URI=https://kalima.my/api/channels/whatsapp/callback
META_VERIFY_TOKEN=          # a string YOU invent: openssl rand -hex 24
META_WHATSAPP_PHONE_ID=     # the sending number's id
META_WHATSAPP_TOKEN=        # permanent System User access token
```

**There is no OAuth step for WhatsApp.** Embedded Signup exists for providers onboarding many
merchants; Kalima is one store with one WABA, so the credential is a permanent System User token in
the environment — the same shape decision EasyParcel forced. `META_WHATSAPP_TOKEN` is never written
to the database. Instead, **Connect WhatsApp** in the admin verifies the token against Graph API and
records the connection, so "Connected" means a real round trip succeeded.

### 2.3 The webhook handshake

Meta verifies your URL with a **GET** carrying `hub.mode=subscribe`, `hub.verify_token` and
`hub.challenge`. Your job: check the token matches `META_VERIFY_TOKEN`, then return
`hub.challenge` **as the raw response body** with a 200.

Already implemented (`verifyMetaSubscription`), and the route returns it as `text/plain`, which is
required — wrapping it in JSON fails the handshake. Verified: the correct token echoes the raw
challenge, a wrong one and a same-length wrong one are both refused 403.

In the Meta dashboard: **WhatsApp → Configuration → Webhook**, set the callback URL to
`https://kalima.my/api/channels/whatsapp/messages/webhook`, paste the verify token, then subscribe
to the **`messages`** field.

### 2.4 Signature verification

Already implemented (`verifyMetaSignature`): HMAC-SHA256 over the raw body keyed on the **App
Secret**, presented as `x-hub-signature-256: sha256=<hex>`, compared in constant time and failing
closed on a missing secret, missing header, wrong prefix, wrong length or mismatch.

Shared with Instagram and Facebook — same app, same secret — so when their App Review lands they
need only their own parse and send.

### 2.5 Sending

Implemented. `POST {phone_number_id}/messages` with `messaging_product: whatsapp`, pinned to Graph
`v21.0` — pinned deliberately, so Meta cannot change the payload shape under a running store without
a deploy. Meta's own error message is surfaced verbatim, because *"more than 24 hours have passed"*
is worth showing a staff member rather than flattening to "send failed".

- **The 24-hour rule** is enforced before the call is made. Outside it only pre-approved **template**
  messages are accepted, and templates are not built.
- The returned `wamid` is stored on the message row, which is what makes delivery receipts
  attributable later.

### 2.6 Customer linking

⚠️ **`wa_id` arrives WITHOUT the leading `+`** — `60123456789`, while `profiles.phone` stores
`+60123456789`. The adapter normalises it. Without that one character the auto-link silently never
matches and every WhatsApp thread shows an unknown sender, even for existing customers. Verified
end to end: a signed payload linked to a real profile.

### 2.7 Test it

1. Message the WABA number from your own phone.
2. `/admin/inbox` should show the thread within seconds, unread, with the window open.
3. Reply from the admin; confirm it arrives on your phone.
4. Add an internal note; confirm it appears in the thread **and never sends**.
5. Leave it 24 h (or set `last_inbound_at` back in the database) and confirm the composer disables
   with the reason.

---

## 3. Instagram DM

**Prerequisite:** an Instagram **professional/business** account, linked to a Facebook Page, on the
same Meta app as WhatsApp.

### 3.1 The approval

Requires **Meta App Review** for `instagram_business_manage_messages`. Budget **2–4 weeks**, and
expect it to be stricter than most:

- You must demonstrate a **business-to-customer support** use case. Anything that looks like
  outbound marketing gets rejected.
- Meta requires a **live, verified webhook endpoint** before review — so §0 must be done first.
- You will be asked for a **screencast** showing the actual flow: a customer message arriving, an
  agent replying from your inbox.

That screencast is easy to record once WhatsApp is live, because it is the same screen. Another
reason to do WhatsApp first.

### 3.2 Before approval

You can test against up to **25 test users** added in the app dashboard without App Review. Use that
to build and verify the adapter, then submit.

### 3.3 Implementation

Largely shared with WhatsApp — same app, same `x-hub-signature-256` scheme, same handshake, same
24-hour window. Differences:

- Subscribe to Instagram messaging webhook fields rather than `messages`.
- The sender is an **Instagram-scoped user id**, not a phone number. There is usually **no phone or
  email**, so pass `contactPhone: null, contactEmail: null` — threads stay unlinked, which is
  expected and handled. Staff can still see the handle.

### 3.4 Register

Meta app → **Instagram → Configuration → Webhooks**, callback URL
`https://kalima.my/api/channels/instagram/messages/webhook`, same verify token.

---

## 4. Facebook Page

Same Meta app, same review track as Instagram — the permission is `pages_messaging`. Submit both in
one App Review to save a round trip.

- Webhook: `https://kalima.my/api/channels/facebook/messages/webhook`, subscribe to the Page's
  `messages` field.
- You need a **Page access token** for the Page in question.
- 24-hour window, same as the others.
- Sender is a Page-scoped user id; same linking caveat as Instagram.

---

## 5. Shopee Chat

### 5.1 The catch — read this before planning

**Shopee's Chat API is whitelist-only.** A Shopee Open Platform partner account does **not**
automatically include it. You must contact the Shopee Open API team and request Chat API access
specifically, with a justification.

Plan for this to be the slowest and least predictable approval. Do not put it on the critical path.

### 5.2 What to obtain

1. A **Shopee Open Platform** developer account at [open.shopee.com](https://open.shopee.com).
2. An **app**, giving you a **Partner ID** and **Partner Key**.
3. **Chat API scope**, requested separately (§5.1).
4. Shop authorisation — the merchant authorises your app against their shop, returning a `shop_id`.

### 5.3 Environment variables

```bash
SHOPEE_PARTNER_ID=
SHOPEE_PARTNER_KEY=
SHOPEE_REDIRECT_URI=https://kalima.my/api/channels/shopee/callback
```

### 5.4 Signing

Shopee signs requests with HMAC-SHA256 over a concatenation of partner id, API path, timestamp,
access token and shop id. Write that helper once in `src/lib/channels/shopee.ts` — the **order and
exact composition of that string is version-specific**, so read it from the current docs. It is
shared with the Phase 8 order webhook, so getting it right unlocks both.

### 5.5 Notes

- **No reply window.** `REPLY_WINDOW_HOURS.shopee` is `null`, so the composer is always enabled.
- Buyers are pseudonymous — expect threads to stay unlinked to customer records.
- Shopee is also a **stock channel**. Connecting it lights up Phase 8 marketplace sync as well; see
  `/admin/sync`.

---

## 6. TikTok Shop chat + Business Messaging

TikTok is **two separate products** behind one channel in this codebase (`tiktok`), because from
the merchant's side it is one authorisation.

| Surface | What it covers | Where |
|---|---|---|
| **TikTok Shop Customer Service API** | Buyer chat about orders | [TikTok Shop Partner Center](https://partner.tiktokshop.com) |
| **Business Messaging API** | Organic TikTok DMs | [TikTok API for Business](https://business-api.tiktok.com) |

### 6.1 Applies to Kalima

Kalima's TikTok is a **Business account**, which is what makes organic DMs reachable at all. TikTok
*personal/creator* DMs have **no API on any platform** — that is a real limitation, but it does not
apply here.

### 6.2 What to obtain

1. **TikTok Shop Partner Center** account → create an app → **App Key** and **App Secret**.
2. Use a **Development Shop** to test before going near the live shop.
3. Separately, request **Business Messaging API** access via the TikTok for Business portal. This is
   a different application from the Shop app.

### 6.3 Environment variables

```bash
TIKTOK_APP_KEY=
TIKTOK_APP_SECRET=
TIKTOK_REDIRECT_URI=https://kalima.my/api/channels/tiktok/callback
```

### 6.4 Notes

- **48-hour window**, not 24. Already encoded — do not hardcode 24 anywhere.
- TikTok signs with HMAC-SHA256 over a sorted-parameter string. Same helper serves the Phase 8 order
  webhook.
- If you get Shop access but not Business Messaging (or vice versa), the adapter can implement one
  surface and return `[]` from the other's parse. The inbox will simply show fewer threads.

---

## 7. Order of attack

```
Now ──► DNS cutover + production deploy + NEXT_PUBLIC_APP_URL        (§0)
   └──► Meta Business verification                    1–3 wk  ──┐
   └──► Shopee Chat API access request  (slow, unpredictable)   │
   └──► TikTok Shop Partner Center app            1–4 wk        │
                                                                 ▼
                                              WhatsApp adapter  ← first live channel
                                                                 │
                                              record the App Review screencast here
                                                                 ▼
                                    Meta App Review: Instagram + Facebook   2–4 wk
                                                                 ▼
                                              Shopee / TikTok as access lands
```

Submit **all** the applications this week — they run in parallel and none of them depend on your
code being finished. Then build the WhatsApp adapter while you wait.

---

## 8. Troubleshooting

| Symptom | Almost always |
|---|---|
| Handshake fails / "callback URL could not be validated" | Verify token mismatch, or the challenge is being returned as JSON. It must be the raw string. |
| Webhook returns **401** | `verifyWebhook` is returning `false`. Either the adapter is still a stub, the signing secret is wrong, or the body was parsed before hashing. |
| Webhook returns **404** | Channel name not in the URL's allowed set, or it lacks the `messaging` capability in `CHANNEL_CAPABILITIES`. |
| Webhook returns **403** on GET | `verifySubscription` returned `null` — the adapter is unwired or the token did not match. |
| Messages arrive but no thread appears | `parseMessageWebhook` returned `[]`. Log the raw payload and compare against the real shape. |
| The same message appears twice | `externalMessageId` is null or not stable. It is the idempotency anchor. |
| Composer disabled unexpectedly | Working as designed. Check `last_inbound_at` — the window measures from the **customer's** last message, and our replies deliberately do not extend it. |
| Reply says "not connected" | `configured()` is `false`, or no row in `channel_connections` with `status='connected'`. |
| `/admin/sync` shows a channel as unavailable | The message distinguishes "credentials not set" (supply keys) from "adapter not implemented" (development work). Read which one it says. |

**Where to look:** every failed import is written to `channel_sync_log` and surfaces in the admin
activity feed, so check there before the server logs.

---

## What is deliberately not built

Be aware of these before promising them:

- **Supabase Realtime** — threads refresh on navigation, not live. Worth adding once there is real
  traffic to test against.
- **Media mirrored to Storage** — attachment URLs are stored as sent. Platform CDN URLs expire, so
  an old attachment becomes a dead link. Needs a wired adapter first, to know what auth their CDN
  requires.
- **WhatsApp message templates** — the only way to message outside the 24-hour window. Each template
  needs its own Meta approval.
- **Outbound-first conversations** — the inbox is for replying. Starting a conversation is what
  templates and Phase 5 broadcasts are for.

---

*Kalima — Nexova Digital. Companion docs: [README.md](./README.md) for the developer view,
[PROJECT_PLAN.md](./PROJECT_PLAN.md) §6 Phase 9 for scope and status,
[supabase/README.md](./supabase/README.md) for the schema.*
