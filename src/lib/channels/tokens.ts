import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { adapterFor } from "./registry";
import {
  ChannelTokenError,
  CHANNEL_LABEL,
  type Channel,
  type TokenPair,
} from "./types";

/*
  Connection state and tokens for the external platforms.

  channel_connections is sealed at the database level — RLS on, no policies, an
  explicit revoke — so every read and write here goes through the service-role
  client and this module is `server-only`. There is no client-side path to a
  marketplace token by construction, not by convention.
*/

function admin() {
  const client = createAdminClient();
  if (!client) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set — channel connections require it.");
  }
  return client;
}

/*
  What the admin screen is allowed to see: connection state without the tokens.

  This matters more than it looks. Server Components serialize whatever they
  pass to a client component into the RSC payload, which ships to the browser.
  A convenient `select('*')` feeding a connection card would put the merchant's
  access token in the page source. So the token columns are never selected on
  the read path at all — the only query that touches them is the refresh path
  below.
*/
export type ChannelConnectionView = {
  channel: Channel;
  shopName: string | null;
  externalShopId: string | null;
  status: "disconnected" | "connected" | "expired" | "error";
  scopes: string[] | null;
  lastSyncAt: string | null;
  lastError: string | null;
  connectedAt: string | null;
  /** Derived, not stored — the expiry itself is not exposed either. */
  tokenExpiringSoon: boolean;
};

const VIEW_COLUMNS =
  "channel, shop_name, external_shop_id, status, scopes, last_sync_at, last_error, connected_at, token_expires_at";

const EXPIRY_WARNING_MS = 24 * 60 * 60 * 1000;

type ViewRow = {
  channel: Channel;
  shop_name: string | null;
  external_shop_id: string | null;
  status: ChannelConnectionView["status"];
  scopes: string[] | null;
  last_sync_at: string | null;
  last_error: string | null;
  connected_at: string | null;
  token_expires_at: string | null;
};

function toView(row: ViewRow): ChannelConnectionView {
  const expires = row.token_expires_at ? new Date(row.token_expires_at).getTime() : null;
  return {
    channel: row.channel,
    shopName: row.shop_name,
    externalShopId: row.external_shop_id,
    status: row.status,
    scopes: row.scopes,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
    connectedAt: row.connected_at,
    tokenExpiringSoon:
      expires !== null && expires - Date.now() < EXPIRY_WARNING_MS,
  };
}

export async function listConnections(): Promise<ChannelConnectionView[]> {
  const { data, error } = await admin().from("channel_connections").select(VIEW_COLUMNS);
  if (error) throw new Error(`listConnections failed: ${error.message}`);
  return (data as ViewRow[]).map(toView);
}

export async function getConnection(channel: Channel): Promise<ChannelConnectionView | null> {
  const { data, error } = await admin()
    .from("channel_connections")
    .select(VIEW_COLUMNS)
    .eq("channel", channel)
    .maybeSingle();
  if (error) throw new Error(`getConnection failed: ${error.message}`);
  return data ? toView(data as ViewRow) : null;
}

/*
  Persists a freshly-authorized connection. Upsert on `channel` because there is
  one account per platform (the table's unique constraint), so re-authorizing
  replaces rather than accumulates — connecting twice must not leave a stale row
  whose token still works.
*/
export async function storeConnection(
  channel: Channel,
  tokens: TokenPair,
  connectedBy: string | null,
): Promise<void> {
  const { error } = await admin().from("channel_connections").upsert(
    {
      channel,
      shop_name: tokens.shopName ?? null,
      external_shop_id: tokens.externalShopId ?? null,
      access_token: tokens.access,
      refresh_token: tokens.refresh,
      token_expires_at: tokens.expiresAt,
      scopes: tokens.scopes ?? null,
      status: "connected",
      last_error: null,
      connected_at: new Date().toISOString(),
      connected_by: connectedBy,
    },
    { onConflict: "channel" },
  );
  if (error) throw new Error(`storeConnection failed: ${error.message}`);
}

/*
  Clears the tokens rather than deleting the row, so the admin card keeps
  showing which platform this was and when it was last connected. A deleted row
  reads as "never set up", which is a different fact.
*/
export async function disconnectChannel(channel: Channel): Promise<void> {
  const { error } = await admin()
    .from("channel_connections")
    .update({
      access_token: null,
      refresh_token: null,
      token_expires_at: null,
      scopes: null,
      status: "disconnected",
      last_error: null,
    })
    .eq("channel", channel);
  if (error) throw new Error(`disconnectChannel failed: ${error.message}`);
}

/*
  Records a failure against the connection so it surfaces on the admin card
  instead of only in a log nobody reads. Swallows its own errors — a bookkeeping
  write must never mask the original fault it is describing.
*/
export async function markChannelError(channel: Channel, message: string): Promise<void> {
  try {
    await admin()
      .from("channel_connections")
      .update({ status: "error", last_error: message.slice(0, 500) })
      .eq("channel", channel);
  } catch {
    // Deliberately ignored — see above.
  }
}

/*
  The ONLY sanctioned way to obtain an access token.

  Refreshes with a five-minute margin and persists the new pair BEFORE
  returning, so a refresh that succeeded upstream is never lost on our side —
  losing it would leave a valid token stranded at the platform and force the
  merchant to re-authorize. Same rule as getValidAccessToken in
  lib/shipping/config.ts.

  A failed refresh marks the connection `expired` rather than leaving it
  looking healthy, because the admin card is where someone finds out they need
  to reconnect.
*/
export async function getValidAccessToken(channel: Channel): Promise<string> {
  const { data, error } = await admin()
    .from("channel_connections")
    .select("access_token, refresh_token, token_expires_at")
    .eq("channel", channel)
    .maybeSingle();
  if (error) throw new Error(`reading ${channel} tokens failed: ${error.message}`);

  const access = (data?.access_token ?? null) as string | null;
  const refresh = (data?.refresh_token ?? null) as string | null;
  const expires = (data?.token_expires_at ?? null) as string | null;

  if (!access || !refresh) {
    throw new ChannelTokenError(channel, `${CHANNEL_LABEL[channel]} is not connected`);
  }

  const margin = 5 * 60 * 1000;
  if (expires && new Date(expires).getTime() - margin > Date.now()) return access;

  let next: TokenPair;
  try {
    next = await adapterFor(channel).refresh(refresh);
  } catch (err) {
    const message = err instanceof Error ? err.message : "token refresh failed";
    await admin()
      .from("channel_connections")
      .update({ status: "expired", last_error: message.slice(0, 500) })
      .eq("channel", channel);
    throw new ChannelTokenError(channel, message);
  }

  const { error: writeErr } = await admin()
    .from("channel_connections")
    .update({
      access_token: next.access,
      refresh_token: next.refresh,
      token_expires_at: next.expiresAt,
      status: "connected",
      last_error: null,
    })
    .eq("channel", channel);
  if (writeErr) throw new Error(`persisting refreshed ${channel} token failed: ${writeErr.message}`);

  return next.access;
}
