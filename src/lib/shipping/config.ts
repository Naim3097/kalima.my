import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { EasyParcelClient, EasyParcelTokenError, OAUTH_BASE } from "./easyparcel";

/*
  EasyParcel connection state for the single Kalima store.

  The reference integration resolves a token per store owner; here there is one
  merchant account, so the tokens live on the store_settings row. Those columns
  are revoked from anon/authenticated at the database level, so they are only
  ever readable through the service-role client below.
*/

const CLIENT_ID = process.env.EASYPARCEL_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.EASYPARCEL_CLIENT_SECRET ?? "";
const REDIRECT_URI = process.env.EASYPARCEL_REDIRECT_URI ?? "";

/** OAuth credentials present — the app *can* connect a merchant account. */
export function easyparcelConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);
}

export type ShippingConfig = {
  enabled: boolean;
  connected: boolean;
  fallbackEnabled: boolean;
  flatShippingSen: number;
  freeShippingThresholdSen: number;
  sender: {
    name: string | null; phone: string | null;
    line1: string | null; line2: string | null;
    city: string | null; postcode: string | null; state: string | null;
  };
};

function admin() {
  const client = createAdminClient();
  if (!client) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return client;
}

export async function getShippingConfig(): Promise<ShippingConfig> {
  const { data, error } = await admin()
    .from("store_settings")
    .select(
      "easyparcel_enabled, easyparcel_access_token, easyparcel_refresh_token, shipping_fallback_enabled, flat_shipping_sen, free_shipping_threshold_sen, sender_name, sender_phone, sender_line1, sender_line2, sender_city, sender_postcode, sender_state",
    )
    .eq("id", 1)
    .single();
  if (error) throw new Error(`getShippingConfig failed: ${error.message}`);

  return {
    enabled: Boolean(data.easyparcel_enabled),
    connected: Boolean(data.easyparcel_access_token && data.easyparcel_refresh_token),
    fallbackEnabled: Boolean(data.shipping_fallback_enabled),
    flatShippingSen: data.flat_shipping_sen as number,
    freeShippingThresholdSen: data.free_shipping_threshold_sen as number,
    sender: {
      name: data.sender_name, phone: data.sender_phone,
      line1: data.sender_line1, line2: data.sender_line2,
      city: data.sender_city, postcode: data.sender_postcode, state: data.sender_state,
    },
  };
}

/** Accepts an absolute expiry or a relative `expires_in`; throws rather than
    letting `new Date(NaN)` leak an "Invalid time value" to a checkout. */
function deriveExpiresAt(payload: Record<string, unknown>): string {
  const absolute = payload.expires_at ?? payload.expiresAt;
  if (typeof absolute === "string") {
    const d = new Date(absolute);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const rel = payload.expires_in ?? payload.expiresIn;
  const seconds = typeof rel === "number" ? rel : parseInt(String(rel ?? ""), 10);
  if (Number.isFinite(seconds)) return new Date(Date.now() + seconds * 1000).toISOString();
  throw new Error("EasyParcel token response carried no usable expiry");
}

async function exchange(body: URLSearchParams): Promise<{
  access: string; refresh: string; expiresAt: string;
}> {
  const res = await fetch(`${OAUTH_BASE}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // client id/secret travel as HTTP Basic, never in the body.
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
    },
    body,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new EasyParcelTokenError(
      String(json.error_description ?? json.error ?? `token exchange failed (${res.status})`),
    );
  }
  const access = String(json.access_token ?? "");
  const refresh = String(json.refresh_token ?? "");
  if (!access || !refresh) throw new EasyParcelTokenError("token exchange returned no tokens");
  return { access, refresh, expiresAt: deriveExpiresAt(json) };
}

export function authUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    state,
  });
  return `${OAUTH_BASE}/login?${p.toString()}`;
}

/** Exchanges the callback code and stores the pair. */
export async function connectWithCode(code: string): Promise<void> {
  const { access, refresh, expiresAt } = await exchange(
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI }),
  );
  const { error } = await admin().from("store_settings").update({
    easyparcel_access_token: access,
    easyparcel_refresh_token: refresh,
    easyparcel_token_expires: expiresAt,
    easyparcel_enabled: true,
  }).eq("id", 1);
  if (error) throw new Error(`storing EasyParcel tokens failed: ${error.message}`);
}

export async function disconnect(): Promise<void> {
  await admin().from("store_settings").update({
    easyparcel_access_token: null,
    easyparcel_refresh_token: null,
    easyparcel_token_expires: null,
    easyparcel_enabled: false,
  }).eq("id", 1);
}

/*
  The ONLY sanctioned way to obtain a token. Refreshes with a 5-minute margin
  and persists the new pair before returning, so a refresh that succeeds is
  never lost.
*/
export async function getValidAccessToken(): Promise<string> {
  const { data, error } = await admin()
    .from("store_settings")
    .select("easyparcel_access_token, easyparcel_refresh_token, easyparcel_token_expires")
    .eq("id", 1)
    .single();
  if (error) throw new Error(`reading EasyParcel tokens failed: ${error.message}`);

  const access = data.easyparcel_access_token as string | null;
  const refresh = data.easyparcel_refresh_token as string | null;
  const expires = data.easyparcel_token_expires as string | null;

  if (!access || !refresh) {
    throw new EasyParcelTokenError("EasyParcel is not connected for this store");
  }

  const margin = 5 * 60 * 1000;
  if (expires && new Date(expires).getTime() - margin > Date.now()) return access;

  const next = await exchange(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
  );
  const { error: writeErr } = await admin().from("store_settings").update({
    easyparcel_access_token: next.access,
    easyparcel_refresh_token: next.refresh,
    easyparcel_token_expires: next.expiresAt,
  }).eq("id", 1);
  if (writeErr) throw new Error(`persisting refreshed token failed: ${writeErr.message}`);

  return next.access;
}

export async function easyparcelClient(): Promise<EasyParcelClient> {
  return new EasyParcelClient(await getValidAccessToken());
}
