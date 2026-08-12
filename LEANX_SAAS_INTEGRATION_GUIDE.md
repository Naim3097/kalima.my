# Integrating LeanX Payments into a SaaS — Complete Guide

A from-scratch, provider-accurate guide to wiring the **LeanX** Malaysian
payment gateway (FPX bank transfers + e-wallets) into a SaaS, based on a working
production integration (Nexova). It covers every field LeanX requires for a call
to succeed, the exact request/response shapes, webhook verification, the
reconciliation paths you need because the gateway is occasionally flaky, and the
multi-tenant credential model.

Everything here is verified against LeanX's live API. Where a field is
**mandatory or the call fails**, it is called out explicitly.

- API host (production): `https://api.leanx.io` — note `.io`, not `.dev`
- Auth is a plain **`auth-token` header**, NOT `Authorization: Bearer`
- Currency: **MYR** only
- Success sentinel on every response: **`response_code === 2000`**

---

## 0. Corrections from a second live integration (NanoRev, 2026-08-05)

Wiring this guide into a second codebase against a **different live merchant
account** contradicted it in four places. Each was found by a real API call, not
by reading. Where this section and the body of the guide disagree, **this
section is the one that was observed**; the originals are kept below so the
difference is visible, since a third account may behave like the first.

Cross-checked against the official reference at
[docs.leanx.io](https://docs.leanx.io/api-docs) (full index: `/api-docs/llms.txt`,
and every page is available as Markdown by appending `.md`).

| # | This guide says | A live account did | Consequence if you follow the guide |
|---|---|---|---|
| 1 | Bank list returns `payment_service_name` and `status` | Returns **`name`** and **`record_status`** / `record_status_id` | Every bank button renders blank — the customer cannot tell Maybank from CIMB |
| 2 | `payment_service_id` is a string | Docs type it **Number**; a string is rejected | `create-bill-silent` fails with undocumented `4566 FAILED` |
| 3 | Webhook is plain JSON + `x-leanx-signature` | Docs specify **`{data: <HS256 JWT signed with the Hash Key>}`**, no header | Every callback 401s. The customer is charged and the order stays `pending` forever |
| 4 | Status endpoint is `/merchant/transaction-status` with a JSON body | It is **`/merchant/manual-checking-transaction`** with `invoice_no` as a **query param** | Every lookup returns `"Requested endpoint is forbidden"` — which reads like a missing account permission and is not |

### 0.1 Normalise the bank list at the boundary

A live account returns:

```jsonc
{ "payment_service_id": 65, "name": "Affin Bank",
  "record_status": "Active", "record_status_id": 1, "rate": 0.8 }
```

Accept **both** spellings, coerce the id, and drop anything unlabelled — a blank
button is worse than a missing one:

```ts
const name = s.payment_service_name || s.name
if (!name || s.payment_service_id == null) return null
const state = (s.status || s.record_status || '').toLowerCase()
if (state && state !== 'active') return null
if (s.record_status_id != null && s.record_status_id !== 1) return null
return { payment_service_id: String(s.payment_service_id), payment_service_name: name }
```

Then convert **back to a number** when creating the bill (see §4).

### 0.2 The webhook may be a signed JWT

The [official callback docs](https://docs.leanx.io/api-docs/cloud-payment/bill/callback.md)
describe a different envelope from §6 of this guide:

```jsonc
{ "data": "eyJhbGciOiJIUzI1NiIs…", "response_code": 2100 }
```

The JWT is HS256-signed with the collection's **Hash Key** — the token *is* the
authentication, and there is no signature header. Decoded claims:

```jsonc
{ "invoice_no": "BP1701155880uBMwB9q0", "invoice_status": "SUCCESS",
  "amount": "456.20", "payment_service_id": 89,
  "client_data": { "merchant_invoice_no": "...", "order_id": "None" },
  "fpx_debit_status": "Approved", "fpx_buyer_name": "..." }
```

Two traps:

- **`order_id` is the literal string `"None"`** when unset, and the claims carry
  LeanX's `invoice_no`, not your `invoice_ref`. Resolve the order by the bill
  number **you stored at creation** — a mapping the payload cannot influence.
- **Pin the algorithm to HS256.** If you accept whatever `alg` the header names,
  a forged token can select `none` and your HMAC check becomes decorative.

Because the two formats are indistinguishable from the outside, accept either —
each on its own proof, neither weakening the other:

```ts
const jwt = body.data
if (typeof jwt === 'string') return verifyJwtHS256(jwt, hashKey)   // shape 1
if (!verifyHmacHeader(rawBody, signature, hashKey)) return null    // shape 2
```

### 0.3 The callback fires on SUCCESS ONLY

> *"Upon every successful transaction, a callback will be send…"*

Cancelled and failed bills are **never pushed**. The merchant dashboard shows
them as `Failed` regardless — LeanX knows, it just does not tell you. The only
way to learn is to **pull** (§0.4).

Design for this explicitly, or an abandoned checkout sits `pending` forever and
the buyer watches a spinner waiting for a message that will never arrive. Give
the return page a definite verdict after a bounded number of polls: *"no
confirmation arrived; if you cancelled you were not charged."*

### 0.4 The status endpoint

```
POST https://api.leanx.io/api/v1/merchant/manual-checking-transaction?invoice_no=<bill_no>
Headers: auth-token: <Auth Token>            # no body
```

```jsonc
{ "response_code": 2000,
  "data": { "transaction_details": {
      "invoice_no": "BP-AD5112621A-LNP", "amount": "15.00",
      "invoice_status": "SUCCESS", "bank_provider": "Maybank2U",
      "amount_with_fee": 15.80, "fee": 0.80 },
    "customer_details": { "name": "...", "phone_number": "...", "email": "..." } } }
```

Still treat any error as **unknown, never failed** — only an explicit verdict
may move an order. Related endpoints if this one is unavailable:
`POST /merchant/bill-id` (get a bill).

### 0.5 Merchant-portal settings that silently break payments

Nothing in the API surfaces these; they are collection checkboxes.

- **Payment Channels** — a channel that is unticked simply never appears in the
  bank list. An empty e-wallet list is a *dashboard* setting, not a bug.
- **Fixed Amount** — undocumented. On a collection whose amount varies per
  order, turn it **off**; the risk is a customer charged an amount that does not
  match their order, which your own amount check will then refuse to fulfil.
- **A new collection means a new UUID *and* a new Hash Key.** The Auth Token is
  account-level and does not change. Rotating the collection without updating
  `LEANX_WEBHOOK_SECRET` gives you the §2 footgun by a different route: bills
  create fine, callbacks 401.

### 0.6 Host-level traps (not LeanX's fault, same outcome)

- **Vercel Deployment Protection.** With *Vercel Authentication* set to
  "all except custom domains", every deployment-specific URL answers the SSO
  wall. If your `callback_url` is built from `VERCEL_URL` rather than an
  explicit public origin, the gateway's POST never reaches your code and
  **nothing appears in your logs** — no rejection, no request, silence.
  Echo the computed callback URL from a health endpoint; the one value that can
  break payments invisibly is otherwise unreadable once marked sensitive.
- **Debounced writes.** If your store batches writes, the pending order must be
  flushed **before** you hand the buyer to the gateway, and the settlement
  flushed **before** you answer the webhook 200 — that 200 tells the gateway to
  stop redelivering. Both windows lose a sale on a crash.
- **Revenue reporting.** The moment orders can be `pending`/`failed`, any
  dashboard that sums all orders starts reporting money that never arrived.

---

## 1. The mental model

LeanX is a **redirect + webhook** gateway, using the "Silent Bill" flow:

```
1. Your server  ──create-bill-silent──▶  LeanX          → returns a redirect_url + bill_no
2. You redirect the customer to that redirect_url
3. Customer pays on LeanX's hosted page (FPX / e-wallet)
4. LeanX ──webhook (HMAC-signed)──▶  your callback_url  → THE authoritative confirmation
5. LeanX redirects the customer back to your redirect_url (display only — never trust it)
6. (Reconciliation) You may also POLL transaction-status for missed webhooks
```

Two hard rules that fall out of this:

- **The webhook is the source of truth for "paid", never the browser redirect.** The
  customer's return to your `redirect_url` proves nothing (they can navigate there
  directly). Only a signature-verified webhook — or a server-side status check —
  may mark an order paid.
- **The amount is decided by YOUR server, never the client.** Look the price up
  server-side before creating the bill. A client-supplied total is a
  price-tampering hole.

---

## 2. Credentials

LeanX issues, per **collection** (a merchant's payment account):

| Credential          | Header/field it maps to   | Used for                                |
| ------------------- | ------------------------- | --------------------------------------- |
| **Auth Token**      | `auth-token` header       | authenticating every merchant API call  |
| **Collection UUID** | `collection_uuid` in body | which account the bill belongs to       |
| **Hash Key**        | HMAC secret for webhooks  | verifying webhook authenticity (see §6) |

There is **one Hash Key per collection**. If you sell several things (e.g.
subscriptions and one-off purchases) through the **same** collection, they share
one Hash Key — don't invent a second "platform secret" that doesn't exist.

### Environment variables (single-tenant / platform setup)

```bash
# Base host — MUST be .io for production. .dev is legacy and often unstable.
LEANX_API_HOST=https://api.leanx.io

# Your collection's credentials
LEANX_AUTH_TOKEN=LP-XXXXXXXX-...        # the "Auth Token"
LEANX_COLLECTION_UUID=Dc-XXXXXXXX-...   # the "Collection UUID"
LEANX_WEBHOOK_SECRET=whsec_xxx          # the "Hash Key" — HMAC secret for webhooks
```

If you run multiple collections (e.g. one for subscriptions, one for token
sales), suffix them (`LEANX_SYSTEM_*`, `LEANX_PLATFORM_*`) — but remember the
Hash Key is per collection, so the webhook verifying a given collection's
payments must use **that** collection's Hash Key.

> ⚠️ **The single most common configuration bug:** gating a webhook route on the
> presence of one env var (`LEANX_SYSTEM_WEBHOOK_SECRET`) while the HMAC code
> reads a _different_ one (`LEANX_WEBHOOK_SECRET`). The route's presence check
> passes, the HMAC then finds nothing, and every webhook 401s — the customer is
> charged and the entitlement is never granted. **Pass the secret explicitly to
> the verify function; don't let the check and the HMAC read different vars.**

### Multi-tenant (marketplace) credential model

If your SaaS lets each customer connect _their own_ LeanX account (so payments go
to the merchant, not you), store per-merchant credentials on the user/merchant
row instead of env vars:

```
profiles.leanx_api_key         -- that merchant's Auth Token
profiles.leanx_collection_uuid -- that merchant's Collection UUID
profiles.leanx_secret_key      -- that merchant's Hash Key (webhook HMAC)
profiles.leanx_enabled         -- boolean gate
profiles.leanx_environment     -- 'live' | 'test'
```

At checkout, resolve which merchant owns the storefront (via the project/store
id), load their credentials, and use those for the create-bill call and for
verifying their webhooks.

> 🔒 **Security note:** a per-merchant Hash Key is a value the merchant typed into
> their own settings, so it is attacker-controlled _for their own account_. Never
> let a webhook fall back to a merchant-supplied secret for payments that credit
> a **platform-owned** resource (e.g. your subscription or token sales) — a buyer
> could then set the key, sign their own "paid" webhook, and mint value for free.
> Platform-credited webhooks must verify against a platform-owned secret only.

---

## 3. ⭐ MANDATORY FIELDS — email and phone are REQUIRED

**LeanX rejects (or silently fails to complete) a bill that does not include a
non-empty `email` AND `phone_number`.** This is the number-one cause of "the
payment won't go through."

- Never send `""`, `null`, or `undefined` for `email` or `phone_number`.
- Collect them on your checkout form: email as `<input type="email" required>`,
  phone as `<input type="tel">`.
- Keep a **server-side placeholder as a safety net** so a missing value never
  produces a failed bill — but treat it as a fallback, not the happy path (you
  need a real email for receipts and any conversion tracking):

```ts
email:
  customer_email && customer_email.trim()
    ? customer_email.trim()
    : 'noreply@yourdomain.com', // placeholder — never send empty
phone_number:
  customer_phone && customer_phone.trim()
    ? customer_phone.trim()
    : '60123456789', // placeholder — never send empty
```

Phone format: Malaysian MSISDN digits, no `+`, e.g. `60123456789` or the local
`0123456789`. Strip spaces/dashes before sending.

---

## 4. Creating a payment — `create-bill-silent`

### Endpoint

```
POST https://api.leanx.io/api/v1/merchant/create-bill-silent

Headers:
  Content-Type: application/json
  auth-token: <your Auth Token>      ← NOT "Authorization: Bearer <...>"
```

### Request body — every field

```jsonc
{
  "collection_uuid": "Dc-XXXX...", // your Collection UUID (required)
  "amount": "79.00", // STRING, exactly 2 decimals (required) — see below
  "invoice_ref": "ORD-1699999999-A1B2", // YOUR order reference (required, must be unique)
  "full_name": "Jane Tan", // customer name (required; use "Customer" if unknown)
  "email": "jane@example.com", // REQUIRED, non-empty (see §3)
  "phone_number": "60123456789", // REQUIRED, non-empty (see §3)
  "redirect_url": "https://you/return", // where LeanX sends the customer back (required)
  "callback_url": "https://you/webhook", // your webhook endpoint (required)
  "payment_service_id": "SVC_ID_HERE", // bank/e-wallet id (REQUIRED for silent bill) — see §5
}
```

Field notes that cause failures if wrong:

- **`amount` must be a 2-decimal STRING**, not a number/float. Use
  `parseFloat(price).toFixed(2)` → `"79.00"`. A raw float is rejected.
- **`invoice_ref` is your own unique reference.** LeanX echoes it back in the
  webhook, so you use it to find the order. Make it unique and prefix it so you
  can tell payment types apart from the ref alone, e.g.:
  - `ORD-{timestamp}-{hex}` — authenticated checkout
  - `INV-{timestamp}-{hex}` — public storefront checkout
  - `SUB-{...}` — subscription, etc.
- **`payment_service_id` is mandatory for the silent-bill flow.** It's the
  specific bank or e-wallet the customer chose (see §5). Omit it and the call
  fails with `missing payment_service_id`.
- **`redirect_url` / `callback_url` must be server-controlled**, built from your
  own base URL — never from a request `Origin`/`Referer` header (an attacker
  could point the payment callback at their own server).

### `amount` — decide it on the server

```ts
// look the price up from YOUR database by product id; never trust a client total
const priceCents = product.base_price_cents; // authoritative
const amount = (priceCents / 100).toFixed(2); // "79.00"
```

### Success response

```jsonc
{
  "response_code": 2000, // ← ALWAYS check this equals 2000
  "description": "...",
  "data": {
    "redirect_url": "https://pay.leanx.io/...", // → redirect the customer here
    "bill_no": "BILL123...", // LeanX's id → store as your transaction_id
    "invoice_ref": "ORD-1699999999-A1B2", // your ref, echoed back
  },
}
```

- `response_code === 2000` **and** `data` present ⇒ success. Anything else is a
  failure; the reason is in `breakdown_errors` or `description`.
- Persist a `transactions` row **now**, at creation, with status `pending`,
  storing `bill_no` (as `transaction_id`) and your `invoice_ref` (as `order_id`).
  The webhook will find and complete it later.
- Then redirect the customer to `data.redirect_url`.

### Reference implementation (server)

```ts
const response = await fetch(
  `${LEANX_API_HOST}/api/v1/merchant/create-bill-silent`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'auth-token': config.authToken, // plain header
    },
    body: JSON.stringify({
      collection_uuid: config.collectionUuid,
      amount, // "79.00"
      invoice_ref: orderId,
      full_name: customerName || 'Customer',
      email: safeEmail, // non-empty
      phone_number: safePhone, // non-empty
      redirect_url: returnUrl, // server-built
      callback_url: webhookUrl, // server-built
      payment_service_id: bankId, // from §5
    }),
  }
);
const result = await response.json();
if (result.response_code === 2000 && result.data) {
  // store pending transaction (bill_no, invoice_ref), then redirect
  return { paymentUrl: result.data.redirect_url, billNo: result.data.bill_no };
}
```

---

## 5. Getting `payment_service_id` — the bank/e-wallet list

Silent Bill requires the customer to pick a specific bank (FPX) or e-wallet
first; that choice is the `payment_service_id`.

### Endpoint

```
POST https://api.leanx.io/api/v1/merchant/list-payment-services

Headers:
  Content-Type: application/json
  auth-token: <your Auth Token>

Body:
{
  "payment_type": "WEB_PAYMENT",          // "WEB_PAYMENT" = FPX banks; "DIGITAL_PAYMENT" = e-wallets
  "payment_status": "active",
  "payment_model_reference_id": 1          // 1 = B2C (individual), 2 = B2B (business)
}
```

- **`payment_type`**: `WEB_PAYMENT` (FPX online banking) or `DIGITAL_PAYMENT`
  (e-wallets like Touch 'n Go, GrabPay, Boost).
- **`payment_model_reference_id`**: `1` for consumer (B2C), `2` for business
  (B2B). Most storefronts want `1`. Query the ones you need.

### Response — WATCH OUT, the shape varies

LeanX returns the list in **different structures** depending on B2C vs B2B and
account type. A robust parser must handle all of these:

```jsonc
// CASE A — flat array (common B2C)
{ "response_code": 2000, "data": [ { "payment_service_id": "...", "payment_service_name": "..." }, ... ] }

// CASE B — object wrapper
{ "response_code": 2000, "data": { "payment_services": [ ... ] } }

// CASE C — deep nested (common B2B/enterprise)
// data.data.list.data[0].WEB_PAYMENT  or  data.data.list.data[0].DIGITAL_PAYMENT
```

Parse defensively:

```ts
let services = [];
if (Array.isArray(data.data))
  services = data.data; // CASE A
else if (data.data?.payment_services)
  services = data.data.payment_services; // CASE B
else if (Array.isArray(data.data?.list?.data)) {
  // CASE C
  const first = data.data.list.data[0];
  services = first?.[payment_type] || []; // WEB_PAYMENT | DIGITAL_PAYMENT
}
// each service: { payment_service_id, payment_service_name, status?, ... }
// filter to active, then present to the customer to choose
```

> ⚠️ **The field names above are not universal — see §0.1.** A live account
> returned `name` / `record_status` instead of `payment_service_name` / `status`,
> and a numeric `payment_service_id`. Handling only the shape shown here renders
> a grid of blank, unlabelled buttons. Normalise both spellings.

Show the returned banks/e-wallets to the customer, capture the selected
`payment_service_id`, and pass it to `create-bill-silent`.

---

## 6. Webhooks — the authoritative confirmation

LeanX POSTs the payment result to your `callback_url`. **This is the only trusted
"paid" signal.**

> ⚠️ **There are two callback formats — see §0.2.** The official docs specify a
> Hash-Key-signed JWT (`{data: "<JWT>"}`) with **no signature header**, not the
> plain JSON + `x-leanx-signature` shown below. Implement only this one and a
> real payment 401s: the customer is charged and the order never settles.
> Accept both.
>
> ⚠️ **Callbacks fire on SUCCESS only — see §0.3.** Cancellations and failures
> are never pushed. Reconciliation (§7) is the only way to see them.

### Verifying authenticity (HMAC-SHA256) — do this FIRST, every time

```ts
import crypto from 'crypto';

export function verifyLeanXWebhook(
  rawBody: string, // the EXACT raw request body bytes
  signature: string, // from the "x-leanx-signature" header
  secretKey: string // your collection's Hash Key
): boolean {
  if (!secretKey) return false; // fail closed if unconfigured
  const expected = crypto
    .createHmac('sha256', secretKey)
    .update(rawBody) // over the raw body string
    .digest('hex');
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'utf-8'),
    Buffer.from(expected, 'utf-8')
  );
}
```

### The rules every webhook handler MUST follow

1. **Read the raw body first** (`await request.text()`) _before_ JSON-parsing —
   the HMAC is computed over the exact raw bytes. Parsing then re-stringifying
   changes them and the signature won't match.
2. Read the signature from the **`x-leanx-signature`** header.
3. **Verify HMAC-SHA256** with a **timing-safe** comparison, using the Hash Key
   for the collection that owns this payment.
4. **Fail closed** — if the secret is unset or the signature is invalid, return
   `401`/`503`. Never process an unverified webhook.
5. Match the transaction by `bill_no` (→ your `transaction_id`), falling back to
   `invoice_ref` (→ your `order_id`).
6. **Be idempotent** — LeanX may deliver the same webhook more than once. Use a
   conditional update (e.g. only flip `pending → completed`) so a redelivery
   doesn't double-credit. Never fire side effects (emails, token grants,
   fulfillment) twice for one payment.
7. Return `200` for a webhook you don't recognize (unknown order) so LeanX stops
   retrying — but do nothing.

### Webhook body fields

```jsonc
{
  "bill_no": "BILL123...", // LeanX id → your transaction_id
  "invoice_ref": "ORD-...", // your ref → your order_id
  "status": "success", // see status mapping below
  "amount": "79.00",
  "payment_method": "fpx",
  "currency": "MYR",
}
```

Some deliveries use generic keys — accept both:
`bill_no || transaction_id`, `invoice_ref || order_id`.

### Status mapping

| LeanX `status`          | Your internal status |
| ----------------------- | -------------------- |
| `success`, `paid`       | `completed`          |
| `pending`, `processing` | `processing`         |
| `failed`, `declined`    | `failed`             |
| `cancelled`             | `cancelled`          |
| `refunded`              | `refunded`           |

> **Verify the amount too.** Before marking paid, confirm the webhook `amount`
> matches the amount you stored for that order. Don't take the webhook's number
> as the source of the price.

### Handler skeleton

```ts
export async function POST(request: Request) {
  const raw = await request.text(); // 1) raw first
  const sig = request.headers.get('x-leanx-signature') || '';
  const secret = process.env.LEANX_WEBHOOK_SECRET; // per-collection Hash Key
  if (!secret) return Response.json({ error: 'unconfigured' }, { status: 503 }); // fail closed
  if (!sig || !verifyLeanXWebhook(raw, sig, secret))
    return Response.json({ error: 'bad signature' }, { status: 401 });

  const { bill_no, invoice_ref, status, amount } = JSON.parse(raw);
  // find the pending order by bill_no, else invoice_ref
  // if not found → return 200 (stop retries), do nothing
  // idempotent conditional update: pending → completed only
  // verify amount matches; then grant/fulfil exactly once
  return Response.json({ success: true });
}
```

---

## 7. Reconciliation — because webhooks and the status API are flaky

Do not rely on the webhook alone. Two independent fallbacks:

### a) Server-side status check — `transaction-status`

> ⚠️ **This path is wrong — see §0.4.** The endpoint is
> `/api/v1/merchant/manual-checking-transaction` with `invoice_no` as a **query
> parameter** and no body; the response nests under
> `data.transaction_details`. The path below answers `"Requested endpoint is
> forbidden"`, which looks like a permission your merchant has to request —
> it is not, and asking support for it wastes days.
>
> This is not merely a fallback. Since callbacks fire on success only (§0.3),
> **this call is the only way to ever learn that a payment was cancelled.**

```
POST https://api.leanx.io/api/v1/merchant/transaction-status
Headers: auth-token: <Auth Token>
Body:    { "bill_no": "BILL123..." }         // or { "invoice_ref": "ORD-..." }
```

Response:

```jsonc
{
  "response_code": 2000,
  "data": {
    "bill_no": "...",
    "invoice_ref": "...",
    "amount": 79.0,
    "status": "success", // map as in §6
    "payment_method": "fpx",
    "completed_at": "...",
  },
}
```

> ⚠️ **`transaction-status` intermittently returns 404 for live bills that
> genuinely exist.** Do NOT treat a single 404 as "payment failed." Retry, or
> fall back to your stored DB state. Only a definitive `failed`/`cancelled`
> status (or an expiry policy you define) should fail an order.

Call this when the customer returns to your `redirect_url` (to show status
without trusting the redirect), and from a manual "verify payment" action.

### b) Your own DB record

Because you created the `pending` row at bill creation (§4), a "check status"
endpoint can read your DB alone — showing the last known state even if LeanX is
unreachable, and letting a later webhook complete it.

---

## 8. Data model — the `transactions` table

Minimum columns for a robust integration:

| Column                        | Notes                                                            |
| ----------------------------- | ---------------------------------------------------------------- |
| `transaction_id`              | LeanX `bill_no` — **UNIQUE** (idempotency anchor)                |
| `order_id`                    | your `invoice_ref`                                               |
| `amount` / `total_amount`     | 2dp; the authoritative server-derived price                      |
| `currency`                    | default `MYR`                                                    |
| `customer_name/_email/_phone` | for receipts + support                                           |
| `status`                      | pending / processing / completed / failed / cancelled / refunded |
| `payment_method`              | e.g. `fpx`                                                       |
| `payment_url`                 | the `redirect_url` returned at creation                          |
| `raw_response` (JSONB)        | full webhook payload, for audit/debugging                        |
| `completed_at`                | set when marked paid                                             |

- Make it an **audit trail**: no client DELETE, writes via a privileged
  (service-role) path only. Never let a client set `status = completed` directly.
- The UNIQUE on `transaction_id` plus a conditional `pending → completed` update
  is what makes webhook redelivery safe.

---

## 9. End-to-end checklist for a new payment route

- [ ] Price is looked up **server-side** by product id; client total is ignored.
- [ ] `amount` is a **2-decimal string** (`.toFixed(2)`).
- [ ] `email` and `phone_number` are **non-empty** (real value or placeholder).
- [ ] `payment_service_id` obtained from the bank list and included.
- [ ] `invoice_ref` is **unique** and prefixed by type.
- [ ] `redirect_url` and `callback_url` built from a **server** base URL, not a
      request header.
- [ ] Auth sent as **`auth-token` header**, not Bearer.
- [ ] Response checked for **`response_code === 2000`**.
- [ ] A **`pending` transaction row** is written at creation.
- [ ] Webhook: raw body read first, **HMAC verified**, fails closed, **idempotent**,
      matches by `bill_no`→`invoice_ref`, **amount verified**.
- [ ] Side effects (grant/fulfil/email) fire **exactly once**.
- [ ] A **status-poll reconciliation** path exists and tolerates spurious 404s.
- [ ] Webhook env var name used by the presence-check **equals** the one the HMAC
      reads.

Added after the NanoRev integration (§0) — every one of these was a real defect:

- [ ] Bank list **normalised** for both field spellings; unlabelled entries dropped.
- [ ] `payment_service_id` sent as a **number**, whatever your transport used.
- [ ] Webhook accepts the **JWT envelope** as well as the header signature, with
      `alg` **pinned to HS256**.
- [ ] The order is resolved from **your stored bill number**, not a ref in the payload.
- [ ] The return page reaches a **definite verdict** — cancellations are never
      pushed, so "confirming…" must not spin forever.
- [ ] The pending order is **durable before** the buyer leaves for the gateway, and
      the settlement durable **before** the webhook is answered 200.
- [ ] The **callback origin is verifiable at runtime** (echo it from a health route).
- [ ] Revenue reporting counts **paid orders only**.
- [ ] The collection's **Payment Channels** include everything you intend to offer,
      and **Fixed Amount is off** for variable-amount collections.

---

## 10. Troubleshooting — real failures and their fixes

| Symptom                                               | Cause                                                                  | Fix                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Bill created but payment "won't go through"           | Empty `email` or `phone_number`                                        | Send non-empty values (real or placeholder) — see §3                            |
| `INVALID_UUID` / response code `5699`                 | Wrong host (`.dev`) or malformed/mismatched `collection_uuid`          | Use `https://api.leanx.io`; verify the Collection UUID                          |
| **`4566` / description `FAILED`** (undocumented)      | `payment_service_id` sent as a string, or a UUID from another collection | Send it as a **Number** (§0.1); re-copy the UUID from the collection you are billing |
| **Blank/unlabelled bank buttons**                     | Account returns `name`, not `payment_service_name`                     | Normalise both spellings (§0.1)                                                 |
| **Every webhook 401s, payments stay `pending`**       | Account sends the **JWT** envelope; handler only reads the header HMAC | Accept both formats (§0.2)                                                      |
| **`"Requested endpoint is forbidden"`**               | Wrong path — `transaction-status` does not exist                       | `POST /merchant/manual-checking-transaction?invoice_no=…` (§0.4). **Not** a permission to request |
| **Cancelled orders never resolve**                    | Callbacks fire on success only                                         | Poll the status endpoint; give the return page a bounded verdict (§0.3)         |
| **Bank list is empty for a whole channel**            | Channel unticked in the merchant portal                                | Collection → Payment Channels → enable → Update (§0.5)                          |
| **No webhook request in your logs at all**            | `callback_url` points at a host behind auth (e.g. Vercel SSO)          | Set an explicit public origin; echo it from a health route (§0.6)               |
| `missing payment_service_id`                          | Silent Bill sent without a bank id                                     | Fetch the bank list (§5), include `payment_service_id`                          |
| Amount rejected                                       | Sent a number/float                                                    | Send a 2-decimal **string** (`"79.00"`)                                         |
| Auth fails on create-bill                             | Used `Authorization: Bearer`                                           | Use the `auth-token` header                                                     |
| `ENOTFOUND` / DNS error                               | Wrong/unreachable host                                                 | `LEANX_API_HOST=https://api.leanx.io`                                           |
| HTTP 404 creating a bill                              | Wrong endpoint path                                                    | `/api/v1/merchant/create-bill-silent`                                           |
| `transaction-status` 404 for a bill that exists       | Known LeanX flakiness                                                  | Retry / fall back to DB state; don't fail the order on one 404 (§7)             |
| `PAYMENT_SERVICE_NOT_ACTIVE`                          | Chosen bank/e-wallet is inactive for this collection                   | Re-fetch the active list; let the customer pick another                         |
| **Webhook 401, payment stuck `pending`, money taken** | Presence-check env var ≠ the var the HMAC reads                        | Make them the same; pass the secret explicitly to the verify function (§2)      |
| Double fulfillment / double credit                    | Webhook redelivered, handler not idempotent                            | Conditional `pending → completed` update; UNIQUE on `transaction_id` (§6, §8)   |
| Free premium / free tokens via forged webhook         | Webhook fell back to a **merchant-supplied** secret for platform value | Verify platform-credited webhooks against a **platform-owned** secret only (§2) |

---

## 11. Endpoint quick reference

| Purpose            | Method + path                                  | Auth                | Key body fields                                                                                                        |
| ------------------ | ---------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Create payment     | `POST /api/v1/merchant/create-bill-silent`     | `auth-token` header | `collection_uuid, amount, invoice_ref, full_name, email, phone_number, redirect_url, callback_url, payment_service_id` |
| List banks/wallets | `POST /api/v1/merchant/list-payment-services`  | `auth-token` header | `payment_type, payment_status, payment_model_reference_id`                                                             |
| Check status       | ~~`POST /api/v1/merchant/transaction-status`~~ **`POST /api/v1/merchant/manual-checking-transaction`** | `auth-token` header | **`?invoice_no=` as a QUERY param, no body** (§0.4) |
| Get a bill         | `POST /api/v1/merchant/bill-id`                | `auth-token` header | `invoice_no`                                                                                                           |
| Webhook (inbound)  | your `callback_url` receives a POST from LeanX | `x-leanx-signature` | `bill_no, invoice_ref, status, amount, payment_method`                                                                 |

All success responses carry `response_code: 2000`. All hosts are
`https://api.leanx.io` in production.
