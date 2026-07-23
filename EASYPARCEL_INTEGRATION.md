# EasyParcel Integration

How shipping works in this app, end to end: OAuth onboarding, live rate
quotations at checkout, shipment booking, tracking, webhooks, and the token
refresh cron.

> **Status: already implemented.** This document describes the integration as it
> exists in the codebase, not a plan. Every file path and behaviour below is
> current as of the `main` branch. If you are adding a new capability, extend the
> pieces described here rather than starting a parallel client.

Related docs:

- [`SPEC-shipping-quote-id.md`](./SPEC-shipping-quote-id.md) — the design behind
  server-issued shipping quotes (why the client never sends a shipping price).
- [`SECURITY-AND-COST-TODO.md`](./SECURITY-AND-COST-TODO.md) — outstanding items,
  including registering the webhook secret and flipping `SHIPPING_QUOTE_STRICT`.

---

## 1. What EasyParcel is, and the multi-tenant model

EasyParcel is a Malaysian shipping aggregator. One API call returns rates from
many couriers (J&T, DHL eCommerce, City-Link, Flash, Ninja Van…), and one more
call books the shipment and returns an AWB / tracking number. The merchant's
EasyParcel **wallet** is debited when a shipment is booked.

This app is a **multi-tenant SaaS**. That shapes everything:

- **We are the OAuth client.** Nexova holds one `EASYPARCEL_CLIENT_ID` /
  `EASYPARCEL_CLIENT_SECRET` pair, registered once with EasyParcel.
- **Each store owner connects their own EasyParcel account.** Their access and
  refresh tokens are stored per user on `profiles`. The store owner's wallet
  pays for their own shipments — Nexova never fronts the shipping cost.
- Every EasyParcel API call is therefore made **on behalf of a specific
  `user_id`**, using that user's token. There is no global service token.

The consequence you must keep in mind when touching this code: *whose token am I
using?* For a public checkout the answer is "the project owner's", resolved via
`projects.user_id`; for a dashboard action it is "the logged-in user's".

---

## 2. Architecture at a glance

```
                          ┌──────────────────────────────────────┐
  Store owner             │  Nexova (Next.js on Vercel)          │        EasyParcel
  (dashboard)             │                                      │
      │                   │  lib/easyparcel-oauth.ts             │
      │  Connect ────────►│  /api/easyparcel/auth-url ───────────┼──►  /oauth/login
      │                   │                                      │
      │◄──── redirect ────┼── /api/easyparcel/callback ◄─────────┼───  (code + state)
      │                   │        └─ exchange ──────────────────┼──►  /oauth/token
      │                   │        └─ store tokens on profiles   │
      │                   │                                      │
  Customer                │  lib/easyparcel.ts (EasyParcelClient)│
  (public checkout)       │                                      │
      │  address ────────►│  /api/shipping/quotation ────────────┼──►  /shipment/quotations
      │◄─ courier list ───┤   └─ freeze rates → shipping_quotes  │
      │  pay ────────────►│  /api/orders/create                  │
      │                   │   └─ charge the CACHED shipping cents│
      │                   │                                      │
  Store owner             │  /api/shipping/book ─────────────────┼──►  /shipment/submit_orders
      │                   │  /api/shipping/cancel ───────────────┼──►  /shipment/cancel
      │                   │  /api/shipping/wallet ───────────────┼──►  /account/wallet
  Customer                │  /api/shipping/track/[orderId] ──────┼──►  /shipment/tracking/{awb}
      │                   │                                      │
      │                   │  /api/shipping/webhook  ◄────────────┼───  status push
      │                   │  /api/cron/refresh-easyparcel-tokens │
      │                   └──────────────────────────────────────┘
```

### File map

| Layer            | File                                                | Responsibility                                                        |
| ---------------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| API client       | `lib/easyparcel.ts`                                 | `EasyParcelClient` — one method per EasyParcel endpoint; `EasyParcelError` |
| OAuth            | `lib/easyparcel-oauth.ts`                           | auth URL, code exchange, refresh, `getValidAccessToken(userId)`        |
| Pricing          | `lib/checkout/pricing.ts`                           | `resolveShippingCents()` — server-authoritative shipping charge        |
| Connect          | `app/api/easyparcel/auth-url/route.ts`              | mints OAuth URL + CSRF state cookie                                    |
| Connect          | `app/api/easyparcel/callback/route.ts`              | verifies state, exchanges code, stores tokens                          |
| Checkout         | `app/api/shipping/quotation/route.ts`               | public rate lookup; issues a `quote_id`                                |
| Checkout         | `app/api/orders/create/route.ts`                    | prices the order incl. quote-backed shipping                           |
| Fulfilment       | `app/api/shipping/book/route.ts`                    | books the shipment, writes AWB back to the transaction                 |
| Fulfilment       | `app/api/shipping/cancel/route.ts`                  | cancels a booked shipment                                              |
| Fulfilment       | `app/api/shipping/wallet/route.ts`                  | merchant wallet balance                                                |
| Tracking         | `app/api/shipping/track/[orderId]/route.ts`         | public tracking by order ref                                           |
| Tracking         | `app/api/shipping/webhook/route.ts`                 | inbound status pushes; promotes COD payments                           |
| Maintenance      | `app/api/cron/refresh-easyparcel-tokens/route.ts`   | daily proactive token refresh (Vercel Cron)                            |
| UI (owner)       | `app/dashboard/settings/shipping/page.tsx`          | connect, sender address, shipping method/fallback                      |
| UI (owner)       | `app/dashboard/transactions/[id]/ship/page.tsx`     | pick courier + collection date, book                                   |
| UI (customer)    | `components/checkout/CourierSelector.tsx`           | React courier picker (builder elements)                                |
| UI (customer)    | `lib/themes/*/modals/Checkout.tsx`                  | theme checkouts (glimsy-v2, byki-workshop)                             |
| UI (customer)    | `lib/publishing/html-generator.ts`                  | the same flow, inlined as vanilla JS into published static pages       |
| Types            | `types/index.ts`                                    | `ShippingAddress`, `ShippingQuotation`, `ShippingStatus`, `MALAYSIAN_STATES` |
| Debug            | `scripts/check-ep-status.ts`                        | probe one merchant's live EasyParcel state from your machine           |

---

## 3. Configuration

### 3.1 Environment variables

| Variable                     | Where           | Purpose                                                                 |
| ---------------------------- | --------------- | ----------------------------------------------------------------------- |
| `EASYPARCEL_CLIENT_ID`       | server          | OAuth client id issued to Nexova by EasyParcel                          |
| `EASYPARCEL_CLIENT_SECRET`   | server          | OAuth client secret (used as HTTP Basic with the id on `/oauth/token`)  |
| `EASYPARCEL_REDIRECT_URI`    | server          | Must **exactly** match what is registered with EasyParcel, e.g. `https://nexova.my/api/easyparcel/callback` |
| `EASYPARCEL_WEBHOOK_SECRET`  | server          | Shared secret the webhook endpoint requires. **Fails closed** — without it, all webhooks are rejected with 503 |
| `CRON_SECRET`                | server (Vercel) | Bearer token Vercel Cron presents to the refresh job                     |
| `SHIPPING_QUOTE_STRICT`      | server          | `'true'` = reject orders whose live-rate shipping is not quote-backed. Anything else = legacy warn-and-clamp mode |
| `NEXT_PUBLIC_APP_URL`        | server          | Base URL the OAuth callback redirects back to                            |
| `NEXT_PUBLIC_SUPABASE_URL`   | server          | Used by the service-role clients in the shipping routes                  |
| `SUPABASE_SERVICE_ROLE_KEY`  | server          | Same — required to read a *store owner's* tokens during a public checkout |

> **Gap to fix:** `.env.example` currently documents only
> `EASYPARCEL_WEBHOOK_SECRET`. `EASYPARCEL_CLIENT_ID`, `EASYPARCEL_CLIENT_SECRET`
> and `EASYPARCEL_REDIRECT_URI` should be added there so a fresh clone doesn't
> silently 500 on `/api/easyparcel/auth-url`.

### 3.2 Vercel Cron

`vercel.json` registers exactly one cron:

```json
{
  "crons": [
    { "path": "/api/cron/refresh-easyparcel-tokens", "schedule": "0 3 * * *" }
  ]
}
```

Daily at 03:00 UTC. See §8.

### 3.3 API base URLs

Both are hardcoded constants, deliberately — there is no per-environment switch:

- `lib/easyparcel.ts` → `https://api.easyparcel.com/open_api/2026-03`
- `lib/easyparcel-oauth.ts` → `https://api.easyparcel.com/oauth`

`profiles.easyparcel_environment` (`'sandbox' | 'live'`) exists in the schema and
is surfaced in the settings UI, **but nothing in the request path reads it** —
every call goes to the production host. Treat that column as informational until
someone wires a sandbox base URL to it.

---

## 4. Data model

All shipping state lives on three existing tables plus one new one. Migrations,
in order:

| Migration                                       | Adds                                                            |
| ----------------------------------------------- | --------------------------------------------------------------- |
| `20260412100000_add_easyparcel_shipping.sql`    | tokens + sender address on `profiles`; shipping fields on `transactions`; weight/dims on `products` |
| `20260708010000_add_shipping_method.sql`        | `shipping_method`, `shipping_flat_rate`                          |
| `20260708020000_add_shipping_fallback.sql`      | `shipping_fallback_enabled`, `shipping_fallback_rate`            |
| `20260722010000_shipping_quotes.sql`            | `shipping_quotes` table + `transactions.shipping_quote_id`       |

### 4.1 `profiles` — per-store configuration

**OAuth credentials**

| Column                            | Notes                                                       |
| --------------------------------- | ----------------------------------------------------------- |
| `easyparcel_access_token`         | short-lived bearer token                                    |
| `easyparcel_refresh_token`        | used to mint new access tokens                              |
| `easyparcel_token_expires_at`     | `timestamptz`; refreshed with a 5-minute safety buffer      |
| `easyparcel_enabled`              | `true` once the OAuth round trip succeeds                   |
| `easyparcel_environment`          | `'sandbox' \| 'live'` — currently unused at runtime (§3.3)  |

**Sender / pickup address** — `shipping_sender_{name,phone,email,address1,address2,postcode,city,state,country}`.
`shipping_sender_state` is an **ISO 3166-2 subdivision code** (`MY-07`, not
`"Penang"`), taken from `MALAYSIAN_STATES` in `types/index.ts`. Getting this
wrong is the single most common cause of "0 quotations returned".

**Shipping charging policy**

| Column                       | Values / meaning                                                            |
| ---------------------------- | --------------------------------------------------------------------------- |
| `shipping_method`            | `easyparcel` (live rates, default) · `free` · `flat`                        |
| `shipping_flat_rate`         | RM charged per order when `method = 'flat'`                                 |
| `shipping_fallback_enabled`  | when live rates fail, charge a flat fee instead of blocking the sale        |
| `shipping_fallback_rate`     | that fee, in RM — the owner is responsible for setting a safe number        |
| `shipping_cost_mode`         | `customer_pays` · `store_absorbs` (renders "FREE") · `free_above_threshold` |
| `shipping_free_threshold`    | subtotal above which shipping is free, for `free_above_threshold`           |

### 4.2 `transactions` — per-order shipping state

| Column                       | Notes                                                                    |
| ---------------------------- | ------------------------------------------------------------------------ |
| `shipping_address`           | `jsonb`, shaped like `ShippingAddress`                                   |
| `shipping_cost`              | RM actually charged — **always** the server-derived figure               |
| `shipping_quote_id`          | FK-ish link back to `shipping_quotes.id` for reconciliation              |
| `shipping_service_id`        | EasyParcel service the buyer chose                                       |
| `shipping_service_name`      | copied from the cached quote when quote-backed                           |
| `shipping_courier_name`      | ditto                                                                    |
| `easyparcel_shipment_id`     | returned by `submit_orders`; the webhook's join key                      |
| `tracking_number`            | AWB                                                                      |
| `shipping_status`            | `pending → booked → picked_up → in_transit → out_for_delivery → delivered`, plus `failed` / `returned` / `cancelled` |
| `is_cod`, `cod_amount`       | cash-on-delivery flags; see §7.2                                         |

### 4.3 `products` — parcel dimensions

`weight_kg` (default `0.5`), `length_cm` / `width_cm` / `height_cm` (default
`10`). These feed the quotation and the booking payload. The defaults mean an
owner who never fills them in still gets *a* rate — just not an accurate one.

### 4.4 `shipping_quotes` — server-issued price freezing

```sql
create table public.shipping_quotes (
  id          uuid primary key default gen_random_uuid(),  -- the quote_id
  project_id  uuid not null,
  user_id     uuid not null,                               -- store owner
  method      text not null,        -- easyparcel | fallback | flat | free
  options     jsonb not null,       -- one entry per courier; amount in CENTS
  inputs      jsonb,                -- address / weight / value (audit trail)
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null  -- issued +30 minutes
);
```

RLS is **on with no policies**, and `revoke all … from public` is applied
explicitly. Only the service-role client (which bypasses RLS) can read or write
it. Nothing in the browser can ever see this table.

Each `options` entry:

```jsonc
{
  "service_id": "EP-CS0IEE",
  "service_name": "Pick Up",
  "courier_name": "J&T Express",
  "amount_cents": 690,          // integer cents — the authoritative price
  "cod_available": true
}
```

---

## 5. OAuth: connecting a store

### 5.1 Flow

```
Owner clicks "Connect EasyParcel"  (dashboard/settings/shipping)
        │
        ▼
GET /api/easyparcel/auth-url                       [session required]
        │  mints state = crypto.randomBytes(32).hex
        │  sets httpOnly cookie `easyparcel_oauth_state` (10 min, SameSite=Lax)
        │  returns { auth_url }
        ▼
Browser → https://api.easyparcel.com/oauth/login?client_id=…&redirect_uri=…&state=…
        │  owner logs into EasyParcel and authorises
        ▼
GET /api/easyparcel/callback?code=…&state=…
        │  1. cookie state === query state?          else → ?error=invalid_state
        │  2. supabase.auth.getUser()                else → ?error=not_authenticated
        │  3. POST /oauth/token  (Basic client_id:client_secret, grant=authorization_code)
        │  4. UPDATE profiles SET tokens…, easyparcel_enabled = true  (cookie-scoped client, RLS backstop)
        │  5. delete the state cookie (one-shot)
        ▼
redirect → /dashboard/settings/shipping?connected=true
```

### 5.2 Security invariants — do not "simplify" these

These are load-bearing, and both are documented in-line at
`app/api/easyparcel/callback/route.ts:36-55`:

1. **`state` carries no identity.** An earlier version did `const userId = state`
   and wrote tokens with the service-role key. That let anyone call the callback
   with their own auth `code` plus a victim's user id and attach *their*
   EasyParcel merchant account to the victim's store — silently receiving every
   shipment the victim booked, along with their customers' names, phone numbers
   and addresses. `state` now proves only that the round trip started in this
   browser.
2. **Identity comes from the Supabase session**, resolved inside the callback.
   The token write uses the **cookie-scoped** client, not the service role, so
   the `"Users can update own profile"` RLS policy is a second line of defence.

The auth-url route is equally strict: it derives the user from the session and
never from a `?user_id=` query parameter.

### 5.3 Token lifecycle

`getValidAccessToken(userId)` in `lib/easyparcel-oauth.ts` is the **only**
sanctioned way to obtain a token. It:

1. Reads the four `easyparcel_*` columns with a service-role client.
2. Throws `EasyParcelTokenError` if the store isn't connected.
3. Returns the stored token if `expires_at - 5min > now`.
4. Otherwise calls `refreshAccessToken()` and **persists the new pair** before
   returning it.

`deriveExpiresAt()` accepts either an absolute `expires_at` string or a relative
`expires_in` (seconds) and **throws** if neither parses. This exists because
`new Date(NaN).toISOString()` once leaked a raw `"Invalid time value"` error to a
paying customer at checkout.

`EasyParcelTokenError` carries `needsReconnect`, which the quotation route uses
to return a customer-safe 503 with `seller_action_required: true` rather than
exposing a token problem to a buyer.

---

## 6. Checkout: quotation → order

This is the security-critical path. Read
[`SPEC-shipping-quote-id.md`](./SPEC-shipping-quote-id.md) for the full rationale.

### 6.1 `POST /api/shipping/quotation`

**Public — no auth.** Called from every cart surface: `CourierSelector`, both
theme checkouts, and the inlined JS in published static pages.

Request:

```jsonc
{
  "project_id": "uuid",
  "receiver_postcode": "11900",
  "receiver_state": "MY-07",      // ISO 3166-2, required
  "receiver_country": "MY",       // default MY
  "total_weight": 1.5,            // kg; defaults to 0.5 server-side
  "dimensions": { "width": 10, "height": 10, "length": 10 },
  "parcel_value": 129.0
}
```

Handler sequence:

1. **Rate limit** — `30 requests / minute` keyed on `(client IP, project_id)`.
   The endpoint is unauthenticated and spends the *store owner's* API quota (and
   can trigger a token refresh), so an anonymous caller could otherwise hammer a
   known `project_id` to burn one specific store's quota. Per-project scoping
   avoids collateral-blocking real customers behind CGNAT who are checking out
   *different* stores.
2. Resolve `projects.user_id` → the store owner.
3. Load the owner's shipping config from `profiles`.
4. Branch on `shipping_method`:
   - **`free` / `flat`** → return one synthetic quotation (`service_id` `"free"`
     or `"flat"`). No EasyParcel call. Every checkout works unchanged because the
     response shape is identical.
   - **`easyparcel`** → require `easyparcel_enabled` + a sender postcode/state,
     then `client.getQuotations(...)`.
5. **Freeze the result**: `issueQuote()` inserts every returned rate into
   `shipping_quotes` with `amount_cents` and a **30-minute** `expires_at`, then
   opportunistically deletes that project's expired rows (a cheap GC — there is
   no separate sweeper job).
6. Respond:

```jsonc
{
  "success": true,
  "quote_id": "uuid-or-null",
  "quotations": [ /* ShippingQuotation[] */ ],
  "shipping_cost_mode": "customer_pays",
  "free_threshold": 0,
  "fallback_used": true            // only on the fallback path
}
```

Persisting the quote is **best-effort**: if the insert fails, the rates are still
returned with `quote_id: null`, and checkout degrades per
`SHIPPING_QUOTE_STRICT` (§6.3).

### 6.2 The fallback ladder

When `shipping_method = 'easyparcel'` and a live rate cannot be produced —
not connected, no sender address, token dead, or EasyParcel is down:

| `shipping_fallback_enabled` | Result                                                                  |
| --------------------------- | ----------------------------------------------------------------------- |
| `true`                      | synthetic quote at `shipping_fallback_rate`, `fallback_used: true`. The sale completes; the owner eats any shortfall. |
| `false`, token problem      | `503` + `seller_action_required: true`, message: *"Shipping is temporarily unavailable for this store. Please contact the seller."* |
| `false`, other error        | `500` (or upstream status) + *"Could not load shipping rates right now."* |

Note what is **not** in those messages: no token state, no EasyParcel error text,
no store internals. The real error is logged server-side.

### 6.3 `POST /api/orders/create` — charging the frozen price

The client sends `shipping_quote_id` + `shipping_service_id`. **It does not send
a price the server trusts.** `resolveShippingCents()` in `lib/checkout/pricing.ts`:

```
method = free       OR cost_mode = store_absorbs   → 0            (serverDerived)
method = flat                                      → flat_rate    (serverDerived)
method = easyparcel / fallback                     → quote lookup:
     SELECT options, expires_at FROM shipping_quotes
      WHERE id = quoteId
        AND project_id = projectId      -- cross-project replay rejected
        AND expires_at > now()          -- expiry enforced
     → options.find(o => o.service_id === serviceId).amount_cents
```

Everything is clamped to `[0, MAX_SHIPPING_CENTS]` (RM 500). The resolved
`service_name` / `courier_name` are copied **from the cached quote**, not from
the request body, so the stored transaction can't be mislabelled either.

**Rollout switch.** Published static snapshots created before this feature don't
send a `quote_id`. So:

- `SHIPPING_QUOTE_STRICT !== 'true'` (current default) — fall back to the legacy
  clamped-client value and log `SHIPPING_QUOTE_MISSING { projectId, reason }`.
- `SHIPPING_QUOTE_STRICT = 'true'` — reject with *"Please refresh the shipping
  rates and choose an option before paying."*

**Flip it to `true` once `SHIPPING_QUOTE_MISSING` drops to ~zero in the logs.**
Until then, live-rate stores remain understate-able. `orders/create` logs
`shipping_server_derived` on every order (it is *not* persisted to a column), so
the function logs are where you audit which orders were quote-backed. The stored
`transactions.shipping_quote_id` is the durable signal: `null` means the order
was priced the legacy way.

The order total is then `subtotalCents + shipping.cents`, where the subtotal is
itself re-derived from `products` rows and owner-authored element props — never
from the request body.

### 6.4 Client-side pieces

`components/checkout/CourierSelector.tsx` is the reference implementation:

- 500 ms debounce on `(postcode, state)` changes; won't fire until the postcode
  is ≥ 5 chars and a state is chosen.
- Stores `quote_id` in state and echoes it through `onSelect(quotation, cost, quoteId)`.
- **Re-fetching resets the selection** (`onSelect(null, 0, newQuoteId)`) so a
  stale courier choice can't be paired with a fresh quote.
- Renders `store_absorbs` / `free_above_threshold` as "FREE" with the real rate
  struck through — the customer sees the discount, and the server independently
  forces the charge to 0.

The theme checkouts (`lib/themes/glimsy-v2`, `lib/themes/byki-workshop`) and the
vanilla-JS version inlined by `lib/publishing/html-generator.ts` replicate this
same contract. **If you change the quotation response shape, all four call sites
must change together.**

---

## 7. Fulfilment

### 7.1 `POST /api/shipping/book`

Dashboard action from `app/dashboard/transactions/[id]/ship/page.tsx`. Requires
CSRF (`validateCsrf`) **and** an authenticated session.

Guards, in order: transaction exists **and** `user_id = session user`;
`shipping_status === 'pending'`; a `shipping_address` is present; the owner has a
sender postcode configured.

It then builds the `submit_orders` payload:

- `reference` = our `transactions.order_id` (this is how you reconcile later).
- Items parsed from `transaction.product_description` (a JSON array).
- Total weight = `Σ (item.weight_kg ?? 0.5) × (item.quantity ?? 1)`, floored to
  `0.5` if the sum is zero.
- `features.email_tracking: true` always; `features.cod` added when `is_cod`.

On success it writes back `easyparcel_shipment_id`, `tracking_number`,
`shipping_service_id/name`, `shipping_courier_name`, and flips
`shipping_status → 'booked'`.

> **Known gap — no idempotency key.** The `shipping_status !== 'pending'` check
> is the only replay guard. Two concurrent requests can both pass it and book two
> shipments (two wallet debits). If you touch this route, add a conditional
> update (`… WHERE shipping_status = 'pending'`) that claims the row *before* the
> EasyParcel call.

> **Known gap — booking doesn't verify the wallet.** If the merchant's wallet is
> empty, EasyParcel rejects the submission and the raw `error.message` is
> returned to the dashboard. `/api/shipping/wallet` exists but is only wired to a
> manual "Check Balance" button.

### 7.2 COD

Cash on delivery inverts the payment flow: the courier collects the money on
delivery, so the transaction is *not* paid when the order is placed. The webhook
closes the loop — see §7.5.

`cod_available`, `cod_max_amount` and `cod_charges_rate` come back per-courier in
the quotation, so the ship page can pre-select the cheapest COD-capable service
for a COD order.

### 7.3 `POST /api/shipping/cancel`

CSRF + session. Only cancels when `shipping_status === 'booked'` and an
`easyparcel_shipment_id` exists; then sets `shipping_status → 'cancelled'`.
Whether the wallet is refunded is EasyParcel's decision, not ours.

### 7.4 `GET /api/shipping/track/[orderId]`

**Public by design** — a buyer tracks without a session, keyed only on the order
ref. It returns no PII: courier, tracking number and delivery events, i.e. the
same data the courier's own public tracking page shows. The residual risk is
*enumeration* ("does this order ref exist"), and the control that fits is a rate
limit (`RATE_LIMITS.MODERATE` on the client identifier).

It fetches live tracking via the **store owner's** token
(`getValidAccessToken(transaction.user_id)`) and **degrades gracefully**: if the
live call throws, it returns the stored `shipping_status` / `tracking_number`
with an empty `events` array rather than an error.

### 7.5 `POST /api/shipping/webhook`

Inbound status pushes from EasyParcel.

**Authentication.** EasyParcel publishes no HMAC signing scheme we implement, so
this uses a shared secret: `EASYPARCEL_WEBHOOK_SECRET`, presented as
`x-webhook-secret` (or `x-easyparcel-secret`, or `?secret=` for consoles that
can't set headers). Comparison is **constant-time** via `crypto.timingSafeEqual`,
with a length check first because that function throws on mismatched lengths.
**The endpoint fails closed** — a missing secret in the environment returns 503
and rejects everything.

This matters because the handler runs on the service-role client and can promote
a COD transaction to `completed` and rewrite tracking numbers. An unauthenticated
version of this endpoint is a free-money bug.

Payload → action:

```jsonc
{ "event_type": "…", "data": { "shipment_id": "…", "current_status": "delivered", "awb_number": "…" } }
```

1. Join `transactions` on `easyparcel_shipment_id`.
2. Map `current_status` through `statusMap` to our `ShippingStatus`; unmapped
   values pass through verbatim.
3. Update `tracking_number` if the AWB changed.
4. **COD settlement:** if `is_cod && status === 'delivered' && status !== 'completed'`,
   set `status = 'completed'` and stamp `completed_at`. Idempotent — it only
   flips once.

**Response discipline:** the route returns `200` even when the transaction isn't
found or processing throws, specifically to stop EasyParcel retrying. Errors are
logged, not surfaced. That means **a silent failure here is invisible to the
sender** — watch the logs, not the HTTP status.

> **Outstanding:** per `SECURITY-AND-COST-TODO.md`, the secret is set in the
> environment but the webhook URL still needs to be **registered with EasyParcel
> carrying the same secret**. Until that's done every push is rejected with 401
> and shipment statuses only advance when someone opens the tracking page.

---

## 8. Token refresh cron

`GET /api/cron/refresh-easyparcel-tokens`, daily at 03:00 UTC via `vercel.json`.

Without it, a token is only refreshed when a customer checks out. An **idle
store's refresh token eventually expires**, and its checkout then breaks until
the owner manually reconnects — a failure the owner discovers from a lost sale.
Refreshing daily keeps every connection alive regardless of traffic.

- Auth: `Authorization: Bearer ${CRON_SECRET}`; 500 if `CRON_SECRET` is unset.
- Selects every profile with `easyparcel_enabled = true` and a non-null refresh
  token, refreshes each **sequentially**, and persists the new pair.
- One store's failure never stops the rest; it's logged and collected.
- Returns `{ total, refreshed, failed, failed_store_ids }`.

Stores in `failed_store_ids` have a dead refresh token and **need a manual
reconnect** — there is currently no automatic owner notification. Worth adding.

---

## 9. Failure modes and how to debug

| Symptom                                         | Likely cause                                                                 | Where to look |
| ----------------------------------------------- | ---------------------------------------------------------------------------- | ------------- |
| "0 quotations returned" for a valid address     | `shipping_sender_state` is a name (`"Penang"`) not a code (`MY-07`); or no sender postcode | The route already logs `data[0]` keys on an empty result — check the function logs |
| Checkout shows "Shipping is temporarily unavailable" | `EasyParcelTokenError` — refresh token dead. `seller_action_required: true` in the response | `scripts/check-ep-status.ts <user_id>` |
| Rates load but the order is charged RM0 shipping | Legacy snapshot with no `quote_id` and `SHIPPING_QUOTE_STRICT` unset          | grep logs for `SHIPPING_QUOTE_MISSING` |
| Shipment statuses never advance past `booked`   | Webhook not registered with EasyParcel, or secret mismatch → 401              | logs: `Shipping webhook rejected: invalid or missing secret` |
| Booking fails with an opaque EasyParcel message  | Empty merchant wallet, or a `service_id` that has since expired               | `/api/shipping/wallet`; re-quote before booking |
| Customer charged a fallback rate unexpectedly    | `shipping_fallback_enabled` fired because live rates failed                   | response carries `fallback_used: true`; check the preceding `EasyParcel quotation failed` log |

**`scripts/check-ep-status.ts`** is the fastest first move for any per-merchant
problem. It loads that merchant's token from Supabase with the service-role key
(the credential never leaves your machine) and probes the real quotations
endpoint:

```bash
npx tsx scripts/check-ep-status.ts <user_id>
```

---

## 10. Adding a new EasyParcel capability

The house pattern, in order:

1. **Add a method to `EasyParcelClient`** (`lib/easyparcel.ts`). Use the private
   `request()` helper so non-2xx responses become `EasyParcelError` with the
   status and body attached. Note that EasyParcel wraps most payloads in
   `{ status_code, data: [...] }` and reports per-item failures as
   `data[0].status === 'error'` with a `data[0].errors` array — check both, as
   `getQuotations` and `submitOrder` do.
2. **Never construct a client with a raw token.** Always
   `new EasyParcelClient(await getValidAccessToken(userId))`, so refresh and
   persistence happen for free.
3. **Pick the right identity.** Public route → the *project owner*
   (`projects.user_id`, via a service-role client). Dashboard route → the
   *session user*, and scope the DB query with `.eq('user_id', user.id)`.
4. **Guard the route.**
   - Public + spends the owner's quota → `rateLimit(...)`.
   - Mutating dashboard action → `validateCsrf(request)` **and**
     `supabase.auth.getUser()`.
   - Inbound from EasyParcel → shared-secret check that fails closed.
5. **Never let a price cross the wire from the client.** If your feature quotes
   money, freeze it in `shipping_quotes` and charge by id.
6. **Keep customer-facing errors generic.** Log the real error with context; tell
   the buyer something actionable and blame-free. Seller-caused problems get
   `seller_action_required: true`.
7. Set `export const dynamic = 'force-dynamic'` and `export const runtime = 'nodejs'`
   — every route here does, and the OAuth code path needs Node's `Buffer`/`crypto`.
8. If it adds a column, write a migration under `supabase/migrations/` with
   `ADD COLUMN IF NOT EXISTS` and a `COMMENT ON COLUMN`, matching the existing
   files. Remember that **staging and prod schemas have drifted** — apply to both
   deliberately, and don't assume a clean replay.

---

## 11. Setup checklist (fresh environment)

1. Register the OAuth app with EasyParcel; set `EASYPARCEL_CLIENT_ID`,
   `EASYPARCEL_CLIENT_SECRET`, and `EASYPARCEL_REDIRECT_URI`
   (`{APP_URL}/api/easyparcel/callback` — must match byte-for-byte).
2. Generate `EASYPARCEL_WEBHOOK_SECRET` (long random string) and **register the
   webhook URL with EasyParcel carrying that secret** in `x-webhook-secret`.
   Target: `{APP_URL}/api/shipping/webhook`.
3. Set `CRON_SECRET` in Vercel so the daily refresh job authenticates.
4. Apply the four shipping migrations (§4).
5. Verify `vercel.json` still carries the cron entry.
6. As a store owner: connect EasyParcel, fill in the **full** sender address
   (state as `MY-xx`), choose a `shipping_method`, and — if on live rates — set a
   sensible `shipping_fallback_rate`.
7. Set product `weight_kg` and dimensions; the `0.5 kg / 10 cm` defaults will
   otherwise quietly misquote every parcel.
8. Run one end-to-end order on a real address, then book it from
   `/dashboard/transactions/[id]/ship` and confirm an AWB comes back.
9. Watch logs for `SHIPPING_QUOTE_MISSING`. Once it's quiet, set
   `SHIPPING_QUOTE_STRICT=true`.

---

## 12. Open items

Carried from `SECURITY-AND-COST-TODO.md` and observed in the code:

- [ ] Register `EASYPARCEL_WEBHOOK_SECRET` with EasyParcel (§7.5) — until then
      shipment statuses don't auto-update.
- [ ] Flip `SHIPPING_QUOTE_STRICT=true` once legacy snapshots are republished (§6.3).
- [ ] Add `EASYPARCEL_CLIENT_ID` / `_CLIENT_SECRET` / `_REDIRECT_URI` to `.env.example` (§3.1).
- [ ] Idempotency on `/api/shipping/book` — claim the row before calling EasyParcel (§7.1).
- [ ] Notify owners whose refresh token died in the nightly cron (§8).
- [ ] Either wire `easyparcel_environment` to a sandbox base URL or drop the column (§3.3).
- [ ] Pre-flight wallet balance check before booking, so the owner gets a clear
      "top up your wallet" instead of a raw EasyParcel error (§7.1).
