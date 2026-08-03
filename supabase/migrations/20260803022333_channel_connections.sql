/*
  Phase 8/9 foundation — connected sales and messaging channels.

  Both marketplace stock sync (Phase 8) and the unified inbox (Phase 9) need the
  same thing first: an authenticated connection to an external platform. This is
  that layer, shared by both, so the OAuth round trip and token refresh are
  written once.

  ONE ROW PER CHANNEL. Kalima is a single store with a single account on each
  platform — the same reasoning that put the EasyParcel tokens on the one
  store_settings row rather than per-user. A unique constraint on `channel`
  makes reconnecting an upsert and leaves no ambiguity about which account is
  authoritative for a given platform.

  TOKEN SECRECY. Unlike EasyParcel — whose tokens had to be bolted onto the
  publicly-readable store_settings row, forcing the blanket grant to be narrowed
  column by column — this is a fresh table and can simply be sealed: RLS on,
  NO policies at all, plus an explicit revoke. Only the service role, which
  bypasses RLS, can read or write it. A marketplace access token is the ability
  to move the client's inventory and read their buyers' messages; nothing in a
  browser has any business seeing one.

  Webhook signing secrets deliberately do NOT live here. They are per-platform
  environment variables, so a database read can never expose the value used to
  authenticate an inbound push, and the webhook handlers fail closed without
  them.
*/

-- Channels we can connect. 'shopee'/'tiktok' drive Phase 8 stock sync;
-- 'whatsapp'/'instagram'/'facebook' drive Phase 9 messaging. TikTok appears
-- once and covers both its Shop and Business Messaging surfaces — they are one
-- authorization from the merchant's point of view.
create type sales_channel as enum ('shopee', 'tiktok', 'whatsapp', 'instagram', 'facebook');

create type channel_connection_status as enum ('disconnected', 'connected', 'expired', 'error');

create table channel_connections (
  id               uuid primary key default gen_random_uuid(),
  channel          sales_channel not null unique,
  -- Display identity, shown on the admin connection card.
  shop_name        text,
  -- The platform's own id for the authorized shop/page/number.
  external_shop_id text,
  access_token     text,
  refresh_token    text,
  token_expires_at timestamptz,
  -- Granted scopes, kept so a missing permission is diagnosable without a
  -- round trip to the platform's console.
  scopes           text[],
  status           channel_connection_status not null default 'disconnected',
  last_sync_at     timestamptz,
  -- Last failure, surfaced on the admin card. Cleared on the next success.
  last_error       text,
  connected_at     timestamptz,
  -- Which staff member authorized it. Denormalised email would be better for
  -- survivability, but unlike the audit log this row is mutable and current by
  -- definition — a stale connector is not a record worth preserving.
  connected_by     uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger channel_connections_updated_at before update on channel_connections
  for each row execute function set_updated_at();

/*
  RLS on with NO policies, plus an explicit revoke — service_role only.
  See the token-secrecy note above; this is the same treatment shipping_quotes
  received, and for the same reason.
*/
alter table channel_connections enable row level security;
revoke all on channel_connections from anon, authenticated, public;
