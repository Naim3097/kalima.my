# Supabase

**Provisioned.** Project `Kalima` · ref `gylsymfonxyegdlfodvk` · Southeast Asia (Singapore) ·
Postgres 17. Schema and seed are applied, RLS is on, and the linter reports zero
security warnings.

> ⚠️ **Single environment.** There is no staging project — every migration from here
> lands directly on the database the store will run on. Dry-run each one first
> (see [Testing a migration](#testing-a-migration-before-it-lands)).

## What is deployed

| Migration | Contents |
|---|---|
| `20260720000001_catalog.sql` | collections, products, variants, images, FTS, RLS |
| `20260720000002_harden_security_definer_helpers.sql` | moves `is_staff()` out of the exposed schema, pins `search_path` |
| `20260721000001_add_variant_color_position.sql` | persists swatch/colour order |
| `20260722000001_auth_profiles_and_roles.sql` | `profiles`, `user_role`, signup pipeline, self-elevation guard |
| `20260722100001_commerce_schema.sql` | orders, order_items, payments, stock_movements, discounts, addresses + RLS |
| `20260722100002_commerce_functions.sql` | create_order, validate_discount, mark_order_paid, get_order_by_reference |
| `20260722100003_admin_adjust_stock.sql` | ledger-backed manual stock adjustment |
| `20260722100004_cms_content.sql` | announcements, hero_slides, content_pages (CMS) + RLS |

## Commerce (Phase 2)

- **Money is integer sen**; order/item prices are **snapshots** taken server-side at
  creation, so catalog edits never rewrite order history.
- **Stock lives only on `product_variants.stock_on_hand`**; every change is a row in
  `stock_movements`. Stock is decremented at **payment**, not order creation, so an
  abandoned pending order holds no inventory.
- **An order becomes `paid` only via `mark_order_paid`** — idempotent (webhook retries
  are safe) and **oversell-guarded** (a line it can't fulfil rolls the whole payment back).
  Called exclusively by the payment webhook after signature verification, never a redirect.
- **All four order functions are `service_role`-only** and invoked from server-side app
  code (`src/lib/commerce.ts`), never exposed as anon/authenticated RPCs. Locking a
  function down needs `revoke from public, anon, authenticated` (all three) — Supabase's
  default privileges grant new public functions explicit anon/authenticated EXECUTE on top
  of the built-in PUBLIC grant.
- Demo discount code `AISYAH10` (10% off) seeded live, out of band.

### Demo data (Phase 3 admin)

Seeded live so the back-office is populated for walkthroughs: **4 customer accounts**
(`nurul.aisyah@`, `siti.khadijah@`, `farah.hanim@`, `aina.sofia@` — all `@gmail.com`,
password `KalimaDemo123!`) and **12 orders** through the real pipeline (paid orders
decremented stock and wrote ledger rows), spread across the last 30 days with a mix of
pending / paid / fulfilled / completed. All figures on the admin dashboard are computed
from these, not mocked. Remove with `delete from auth.users where email like '%@gmail.com'`
plus the guest orders (`email like 'walkin%'`) when real traffic arrives.

> **`SUPABASE_SERVICE_ROLE_KEY` is now required.** Order creation, the payment webhook and
> order lookup all run through it. Add it from Project Settings → API. The app builds
> without it, but checkout will error at runtime until it is set.

### Payment — LeanX (FPX + e-wallets)

`src/lib/payments/leanx.ts` implements LeanX's Silent Bill flow per
`LEANX_SAAS_INTEGRATION_GUIDE.md`. Checkout falls back to "order received, payment pending"
until the credentials are set; then it becomes:

`place order → /checkout/pay (pick bank/e-wallet) → LeanX hosted page → webhook → paid`.

| Env var | Notes |
|---|---|
| `LEANX_API_HOST` | `https://api.leanx.io` (must be `.io`) |
| `LEANX_AUTH_TOKEN` | "Auth Token" — sent as the `auth-token` header |
| `LEANX_COLLECTION_UUID` | "Collection UUID" |
| `LEANX_WEBHOOK_SECRET` | "Hash Key" — webhook HMAC; without it the webhook fails closed (401) |

The webhook (`/api/payments/webhook`) is the only path to `paid`: it verifies HMAC-SHA256
over the raw body (`x-leanx-signature`), matches the order by `bill_no`, checks the amount
against the stored total, then calls the idempotent `mark_order_paid`. Verified with a
signed test webhook: bad signature → 401, valid → paid + stock decremented, replay →
no double-decrement, amount mismatch → 409.

Seeded from `seed.sql`: 10 collections · 13 products · 188 variants · 8 images ·
23 curated memberships.

## Auth & roles

- **Roles** (`customer`/`staff`/`admin`/`affiliate`) live in the JWT `app_metadata.role`
  claim — the same source `private.is_staff()` and RLS read. `profiles.role` mirrors it;
  triggers keep them in sync. A customer **cannot** self-elevate (`protect_profile_role`).
- **Admin bootstrap** is the `role_grants` allowlist: an email in it is granted its role
  the moment it signs up, before the account exists. Grants are **data, seeded out of band**
  so no personal email lands in the repo:
  ```sql
  insert into role_grants (email, role) values ('you@example.com', 'admin');
  ```
  `freelancerzafs@gmail.com → admin` is already seeded on the live project. Sign up with
  that email (your own password) to get the first admin.
- **Route gates**: `/admin` → staff/admin (proxy + admin layout, defence in depth);
  `/account` → any signed-in user.
- All auth helpers are SECURITY DEFINER in the **`private`** schema (not PostgREST-exposed),
  with `search_path` pinned. Linter: **zero warnings.**

> **Email confirmation is on** with Supabase's default SMTP, which is rate-limited to a few
> sends/hour — fine for real traffic, painful for bulk testing. For faster local testing,
> disable "Confirm email" under Auth → Providers in the dashboard, or wire custom SMTP.
> Do **not** create test users by inserting into `auth.users` directly: GoTrue can't scan
> NULL token columns (`confirmation_token` etc.), so those accounts fail at login.

`seed.sql` is **generated** from `src/data/catalog.ts` — never edit it by hand.
After changing the catalog:

```bash
npm run seed:generate
```

## Design notes

- **Money is `integer` sen**, never float (§4.2 money integrity). `price_sen` 29500 = RM295.
- **Stock lives only on `product_variants.stock_on_hand`**, with a `>= 0` check
  constraint. Phase 2 adds the `stock_movements` ledger; after that nothing should
  write stock directly.
- **`private.is_staff()`** reads the `app_metadata.role` JWT claim. It lives in the
  `private` schema because PostgREST exposes `public` — a `SECURITY DEFINER` function
  there is callable as `/rest/v1/rpc/…`. It cannot simply have `EXECUTE` revoked:
  RLS policy expressions run as the *querying* role, so `anon`/`authenticated` need it.
- **Policies wrap the call as `(select private.is_staff())`** so Postgres evaluates it
  once per query instead of once per row.
- **No session satisfies the staff claim yet.** The auth hook that populates it arrives
  in Phase 2, so today the catalog is effectively read-only to the world.

## Environment

`.env.local` (gitignored) holds:

| Var | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server clients |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable key; safe in the browser, RLS applies |
| `SUPABASE_SERVICE_ROLE_KEY` | **blank on purpose.** Bypasses RLS. Only add it when a route handler genuinely needs admin writes (Phase 3). |

Restart `npm run dev` after editing env vars.

## Testing a migration before it lands

There is no staging project, so validate locally first. This needs no Docker —
just the Homebrew Postgres already installed:

```bash
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
PGDATA=/tmp/klm-pgdata; SOCK=/tmp/klm-pg
initdb -D "$PGDATA" -U postgres --auth=trust
pg_ctl -D "$PGDATA" -o "-p 55433 -k $SOCK -c listen_addresses=''" -l "$PGDATA/log" start

createdb -h $SOCK -p 55433 -U postgres kalima_check
# Stub the Supabase-managed surface the migrations depend on
psql -h $SOCK -p 55433 -U postgres -d kalima_check <<'SQL'
create schema auth;
create function auth.jwt() returns jsonb language sql stable
  as $$ select current_setting('request.jwt.claims', true)::jsonb $$;
create role anon; create role authenticated; create role service_role;
grant usage on schema auth to anon, authenticated;
SQL

psql -h $SOCK -p 55433 -U postgres -d kalima_check -v ON_ERROR_STOP=1 \
  -f supabase/migrations/<new>.sql

pg_ctl -D "$PGDATA" stop -m immediate && rm -rf "$PGDATA" "$SOCK"
```

Worth asserting explicitly on anything touching RLS — `set local role anon;` then
confirm reads return what you expect and writes affect **0 rows**.

## Applying a migration

Via the Supabase MCP (`apply_migration`), or the CLI once it is authenticated as the
account owning this project:

```bash
supabase link --project-ref gylsymfonxyegdlfodvk
supabase db push
```

Run the linter after any DDL change — it catches missing RLS and mutable
`search_path` automatically:

```
get_advisors(project_id, type: "security")
```

## Regenerating TypeScript types

Not committed today because nothing imports it yet. When the data layer moves onto
Supabase (Phase 2), generate it then:

```bash
supabase gen types typescript --project-id gylsymfonxyegdlfodvk > src/lib/supabase/types.ts
```

Then parameterise the clients as `createClient<Database>(...)`.

## Next: swap the data layer

The fetchers in `src/data/catalog.ts` (`fetchProducts`, `fetchProductBySlug`,
`fetchCollection`) keep their signatures — replace the array lookups with Supabase
queries and every caller keeps working. Note the shape differences to map:

| App | Database |
|---|---|
| `price: 295` | `price_sen: 29500` |
| `colors[]` with `hex`, optional `image` | `product_variants` (colour × size) + `product_images.color_name` |
| `sizes[]` | distinct `product_variants.size` |
| `collection: "maya"` | `collection_products` join, or product flags for smart collections |
