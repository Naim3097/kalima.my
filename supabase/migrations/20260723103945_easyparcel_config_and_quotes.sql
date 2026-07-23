/*
  Phase 4 — EasyParcel configuration and server-issued shipping quotes.

  Kalima is a SINGLE store, so unlike the multi-tenant reference integration the
  OAuth tokens live on the one store_settings row rather than per-user profiles.
  There is exactly one EasyParcel merchant account and one wallet.

  shipping_quotes is the money-integrity piece and mirrors the existing rule
  that the client never sends a price: checkout receives a quote_id, and the
  server later looks the amount up by (quote_id, service_id) with expiry
  enforced. A tampered client can pick a different courier, never a different
  price.
*/

-- Sender address + connection state for the one merchant account.
alter table store_settings add column easyparcel_enabled        boolean not null default false;
alter table store_settings add column easyparcel_access_token   text;
alter table store_settings add column easyparcel_refresh_token  text;
alter table store_settings add column easyparcel_token_expires  timestamptz;
alter table store_settings add column sender_name               text;
alter table store_settings add column sender_phone              text;
alter table store_settings add column sender_line1              text;
alter table store_settings add column sender_line2              text;
alter table store_settings add column sender_city               text;
alter table store_settings add column sender_postcode           text;
-- ISO 3166-2 subdivision, e.g. MY-10 for Selangor.
alter table store_settings add column sender_state              text;
-- Charged when a live rate cannot be produced, so a sale never blocks on the API.
alter table store_settings add column shipping_fallback_enabled boolean not null default true;

/*
  The tokens are secrets. store_settings is publicly readable (the storefront
  shows the free-shipping threshold), so the anon/authenticated grant must be
  narrowed to the non-secret columns — a blanket `grant select` here would
  publish the merchant's EasyParcel access token to every visitor.
*/
revoke select on store_settings from anon, authenticated;
grant select (
  id, store_name, store_email, store_phone, currency,
  free_shipping_threshold_sen, flat_shipping_sen, tax_rate_bps, updated_at
) on store_settings to anon, authenticated;

create table shipping_quotes (
  id         uuid primary key default gen_random_uuid(),
  method     text not null,        -- easyparcel | fallback | flat | free
  options    jsonb not null,       -- [{ service_id, service_name, courier_name, amount_sen, cod_available }]
  inputs     jsonb,                -- address / weight / value, kept as an audit trail
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index shipping_quotes_expires_idx on shipping_quotes (expires_at);

/*
  RLS on with NO policies, plus an explicit revoke: only the service role (which
  bypasses RLS) may read or write. Nothing in a browser can ever see this table
  — seeing it would reveal every courier price before the server picks one.
*/
alter table shipping_quotes enable row level security;
revoke all on shipping_quotes from anon, authenticated, public;
