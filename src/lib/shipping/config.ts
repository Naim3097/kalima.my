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

/*
  When the REFRESH token lapses — roughly a year out, per EasyParcel's
  refresh_token_expires_in. Absent on responses that do not carry it, in which
  case whatever we already knew stands.
*/
function deriveRefreshExpiresAt(payload: Record<string, unknown>): string | null {
  const rel = payload.refresh_token_expires_in ?? payload.refreshTokenExpiresIn;
  const seconds = typeof rel === "number" ? rel : parseInt(String(rel ?? ""), 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

/*
  `keepRefresh` is the refresh token we already hold, and it is what makes a
  renewal survive.

  EasyParcel returns a NEW refresh token only sometimes — its own documentation
  says "depends if requested". This function used to demand one on every
  response and throw "token exchange returned no tokens" when it was absent,
  which would have killed a perfectly healthy connection at the first renewal
  and sent every overseas shopper to the WhatsApp fallback. A rotation is
  therefore an update, never a requirement: if one arrives we store it, and if
  it does not we keep the token that just worked.

  The initial code-for-token exchange passes nothing here, because there it
  genuinely is an error to come back without a refresh token — there is no
  earlier one to fall back on.
*/
async function exchange(body: URLSearchParams, keepRefresh?: string): Promise<{
  access: string; refresh: string; expiresAt: string; refreshExpiresAt: string | null;
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
  const refresh = String(json.refresh_token ?? "") || (keepRefresh ?? "");
  if (!access) throw new EasyParcelTokenError("token exchange returned no access token");
  if (!refresh) throw new EasyParcelTokenError("token exchange returned no refresh token");
  return {
    access,
    refresh,
    expiresAt: deriveExpiresAt(json),
    refreshExpiresAt: deriveRefreshExpiresAt(json),
  };
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
  const { access, refresh, expiresAt, refreshExpiresAt } = await exchange(
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI }),
  );
  const { error } = await admin().from("store_settings").update({
    easyparcel_access_token: access,
    easyparcel_refresh_token: refresh,
    easyparcel_token_expires: expiresAt,
    easyparcel_refresh_expires: refreshExpiresAt,
    easyparcel_enabled: true,
  }).eq("id", 1);
  if (error) throw new Error(`storing EasyParcel tokens failed: ${error.message}`);
}

export async function disconnect(): Promise<void> {
  await admin().from("store_settings").update({
    easyparcel_access_token: null,
    easyparcel_refresh_token: null,
    easyparcel_token_expires: null,
    easyparcel_refresh_expires: null,
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
    /* Keep the token that just worked if the response carries no new one. */
    refresh,
  );
  const { error: writeErr } = await admin().from("store_settings").update({
    easyparcel_access_token: next.access,
    easyparcel_refresh_token: next.refresh,
    easyparcel_token_expires: next.expiresAt,
    /* Only when the response said so. A renewal that does not restate the
       refresh window has not moved it, and overwriting with null would erase
       the one date the Shipping screen has to warn from. */
    ...(next.refreshExpiresAt ? { easyparcel_refresh_expires: next.refreshExpiresAt } : {}),
  }).eq("id", 1);
  if (writeErr) throw new Error(`persisting refreshed token failed: ${writeErr.message}`);

  return next.access;
}

export async function easyparcelClient(): Promise<EasyParcelClient> {
  return new EasyParcelClient(await getValidAccessToken());
}

/*
  Daily proof that the connection still works, run from the order-expiry cron.

  WHY IT NEEDS PROVING. Renewal only happens when a checkout asks for a token,
  so a broken renewal stays invisible until an overseas shopper meets it — and
  since Malaysian orders never touch EasyParcel, that could be weeks. This runs
  the same path a checkout runs, a day ahead of anyone who cares.

  The daily cadence does the work for free: the access token lives about ten
  hours, so a check twenty-four hours later almost always finds it stale and
  performs a real refresh. That is the fragile step and the one worth
  exercising — a check that only read a still-valid token would prove nothing.

  Then one authenticated call, because a token the server accepts is the only
  evidence that matters. The wallet is the cheapest endpoint that requires one.

  NOT CONNECTED IS NOT A FAILURE. A shop that has not linked EasyParcel, or has
  deliberately disconnected it, is in a valid state — reporting that as broken
  would train whoever reads this to ignore it.
*/
export type ConnectionCheck = {
  status: "ok" | "not-connected" | "failed";
  detail: string;
  /** True when this check performed a real token renewal — the fragile step. */
  renewed: boolean;
};

export async function checkConnection(): Promise<ConnectionCheck> {
  if (!easyparcelConfigured()) {
    return { status: "not-connected", detail: "EasyParcel OAuth credentials are not set.", renewed: false };
  }

  const cfg = await getShippingConfig();
  if (!cfg.enabled || !cfg.connected) {
    return { status: "not-connected", detail: "No EasyParcel account is linked.", renewed: false };
  }

  /* Read before, compare after: the only way to know whether the renewal
     actually ran, rather than the stored token merely still being valid. */
  const { data: before } = await admin()
    .from("store_settings")
    .select("easyparcel_token_expires")
    .eq("id", 1)
    .single();

  try {
    const client = await easyparcelClient();
    await client.getWalletBalanceSen();

    const { data: after } = await admin()
      .from("store_settings")
      .select("easyparcel_token_expires, easyparcel_refresh_expires")
      .eq("id", 1)
      .single();

    const renewed = before?.easyparcel_token_expires !== after?.easyparcel_token_expires;
    const lapses = after?.easyparcel_refresh_expires as string | null | undefined;

    return {
      status: "ok",
      detail: lapses
        ? `Connection healthy; it lapses ${new Date(lapses).toISOString().slice(0, 10)}.`
        : "Connection healthy; no lapse date recorded.",
      renewed,
    };
  } catch (e) {
    return {
      status: "failed",
      detail: e instanceof Error ? e.message : "Could not reach EasyParcel.",
      renewed: false,
    };
  }
}
