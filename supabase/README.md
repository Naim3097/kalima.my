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

Seeded from `seed.sql`: 10 collections · 13 products · 188 variants · 8 images ·
23 curated memberships.

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
