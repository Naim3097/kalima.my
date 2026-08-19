import "server-only";

import crypto from "node:crypto";
import { GRAPH } from "@/lib/channels/meta";
import {
  eventIdFor,
  normaliseForHash,
  normalisePhone,
  type CapiEvent,
} from "@/lib/meta/events";

/*
  Meta Conversions API — the shop's only connection to Meta's ads reporting.

  There is NO Meta Pixel on this site. Everything Meta knows about a Kalima
  shopper arrives through this file, which makes two things true that would be
  merely nice with a Pixel in place:

    - `fbp` and `fbc` are minted by src/proxy.ts, not by a Pixel script. Without
      them a server event can only be matched on hashed email and phone, and a
      click-through from an ad cannot be attributed at all.
    - A failure here is invisible. Nothing on the storefront changes when Meta
      rejects an event, so the caller logs and the dead letter keeps the payload.

  ONE EVENT PER REQUEST, never a batch. Meta rejects an ENTIRE request if any
  single event in it is invalid — so a malformed Search riding along with a
  Purchase would discard the Purchase. Batching is what the endpoint offers;
  it is not what a shop that cares about its conversions should take.
*/

const PIXEL_ID = process.env.META_PIXEL_ID ?? "";
const ACCESS_TOKEN = process.env.META_CAPI_TOKEN ?? "";
/* Events Manager → Test Events. Set it and events appear there INSTEAD of in
   reporting, which is exactly what you want while proving a payload and
   exactly what you do not want left on afterwards. */
const TEST_EVENT_CODE = process.env.META_CAPI_TEST_EVENT_CODE ?? "";

/*
  Staging runs this same code. Every Playwright run, every browser rehearsal and
  every order I place to prove a checkout would otherwise land in the shop's ads
  reporting as a real conversion — and a corrupted dataset is worse than an
  empty one, because it looks like data. Same gate the GTM container uses in
  src/app/(storefront)/layout.tsx, and set by Vercel itself so there is nothing
  to configure and nothing to forget.
*/
const IS_PRODUCTION = process.env.VERCEL_ENV === "production";

/** Credentials present. Unset is a valid state, not an error — see sendEvent. */
export function capiConfigured(): boolean {
  return Boolean(PIXEL_ID && ACCESS_TOKEN);
}

/** Names only, never values, so an admin screen can say which one is missing. */
export function capiMissingEnv(): readonly string[] {
  const missing: string[] = [];
  if (!PIXEL_ID) missing.push("META_PIXEL_ID");
  if (!ACCESS_TOKEN) missing.push("META_CAPI_TOKEN");
  return missing;
}

export class CapiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "CapiError";
    this.status = status;
  }
}

/*
  SHA-256 hex of a normalised value, which is the only form Meta accepts for
  customer information. Returns null rather than the hash of an empty string —
  `e3b0c442…` is a perfectly valid digest of nothing, and sending it would tell
  Meta we know an email address that does not exist.
*/
function hash(value: string | null | undefined): string | null {
  const normalised = normaliseForHash(value);
  if (!normalised) return null;
  return crypto.createHash("sha256").update(normalised).digest("hex");
}

function hashPhone(value: string | null | undefined, country: string | null | undefined): string | null {
  const digits = normalisePhone(value, country);
  if (!digits) return null;
  return crypto.createHash("sha256").update(digits).digest("hex");
}

/*
  What we know about the person, before hashing.

  fbp, fbc, ip and userAgent are the four that must NOT be hashed. Hashing them
  is the classic silent mistake: the request succeeds, Meta stores a value it
  cannot use, and the only symptom is a match quality score nobody checks.
*/
export type CapiIdentity = {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  city?: string | null;
  state?: string | null;
  postcode?: string | null;
  country?: string | null;
  /** Our own user id, so repeat customers correlate across events. */
  externalId?: string | null;
  /** Raw. Minted by src/proxy.ts because there is no Pixel to mint them. */
  fbp?: string | null;
  fbc?: string | null;
  /** Raw. MUST be the shopper's, never a webhook caller's — see buildUserData. */
  ip?: string | null;
  userAgent?: string | null;
};

/*
  Meta's `user_data`, with every empty field dropped.

  ABSENT IS BETTER THAN EMPTY. Meta scores match quality per parameter, and a
  key present with a null value counts against that score rather than being
  ignored — so a guest checkout with no last name should send no `ln` at all.

  THE IP AND USER AGENT ARE A TRAP. Purchase fires from a payment webhook, whose
  request belongs to LeanX in a datacentre, not to the shopper on their phone.
  Passing that request's ip/userAgent would attach every conversion the shop
  makes to the gateway — wrong device, wrong network, usually wrong country.
  They are captured at checkout, stored on the order, and replayed here.
*/
function buildUserData(id: CapiIdentity): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  /* Hashed fields travel as arrays — Meta accepts several values per key for
     people with more than one address on file. We only ever have one. */
  const put = (key: string, value: string | null) => {
    if (value) data[key] = [value];
  };

  put("em", hash(id.email));
  /* The country is what turns "0123456789" into a number Meta can match — see
     normalisePhone. Passing it is not optional for Malaysian orders. */
  put("ph", hashPhone(id.phone, id.country));
  put("fn", hash(id.firstName));
  put("ln", hash(id.lastName));
  put("ct", hash(id.city));
  put("st", hash(id.state));
  put("zp", hash(id.postcode));
  put("country", hash(id.country));
  /* Hashing external_id is recommended rather than required, and hashing keeps
     our internal user ids out of a third party's store. */
  put("external_id", hash(id.externalId));

  // The four that are sent raw. See the note above.
  if (id.fbp) data.fbp = id.fbp;
  if (id.fbc) data.fbc = id.fbc;
  if (id.ip) data.client_ip_address = id.ip;
  if (id.userAgent) data.client_user_agent = id.userAgent;

  return data;
}

export type CapiPayload = {
  event: CapiEvent;
  /** Stable id for dedup and safe retries; random when there is no natural key. */
  eventId?: string | null;
  /** Seconds, not milliseconds. Meta rejects the whole request beyond 7 days. */
  eventTime?: number;
  sourceUrl: string;
  identity: CapiIdentity;
  /** value/currency/contents/content_ids/search_string, per event. */
  custom?: Record<string, unknown>;
};

/** The exact JSON Meta receives. Built separately so the dead letter can store
    a payload that is replayable verbatim, rather than the arguments it was
    assembled from. */
export function buildEvent(payload: CapiPayload): Record<string, unknown> {
  const event: Record<string, unknown> = {
    event_name: payload.event,
    event_time: payload.eventTime ?? Math.floor(Date.now() / 1000),
    event_id: eventIdFor(payload.eventId),
    /* Required for every website event, alongside client_user_agent and
       event_source_url. Kalima has no app and no offline events, so this is
       always "website". */
    action_source: "website",
    event_source_url: payload.sourceUrl,
    user_data: buildUserData(payload.identity),
  };
  if (payload.custom && Object.keys(payload.custom).length > 0) {
    event.custom_data = payload.custom;
  }
  return event;
}

/*
  Sends one event and returns whether Meta accepted it.

  NEVER THROWS TO ITS CALLER — every call site is a side effect on a path that
  matters more than analytics (a settlement, a checkout, a product page), and an
  ads integration must not be able to break any of them. The boolean is for the
  dead letter: false means "keep this payload and try again", not "tell the
  customer something went wrong".

  Not configured returns true, deliberately. A shop that has not set the
  credentials is in a valid state, not a failing one, and treating it as a
  failure would fill the dead-letter table with events that were never going to
  be sent — the same reasoning as `easyparcelConfigured` and the email module.
*/
export async function sendEvent(payload: CapiPayload): Promise<boolean> {
  if (!IS_PRODUCTION) return true;
  if (!capiConfigured()) return true;

  try {
    return await postEvent(buildEvent(payload));
  } catch (e) {
    console.error("[capi] send failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

/*
  The raw POST, exported so the dead-letter drain can replay a stored payload
  without rebuilding it — a replay must send what was originally assembled, not
  re-derive it from an order that may have been refunded since.
*/
export async function postEvent(event: Record<string, unknown>): Promise<boolean> {
  const body: Record<string, unknown> = { data: [event] };
  if (TEST_EVENT_CODE) body.test_event_code = TEST_EVENT_CODE;

  let res: Response;
  try {
    res = await fetch(`${GRAPH}/${PIXEL_ID}/events?access_token=${encodeURIComponent(ACCESS_TOKEN)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      /*
        THREE SECONDS, AND THIS ONE IS NOT DECORATION. The Purchase send happens
        inside a payment webhook, and settle.ts opens with "NEVER 500 AT A
        GATEWAY" — a hung call to Meta would hold the gateway's connection open
        until the function is killed, which the gateway reads as a failure and
        retries. Meta being slow must never look to LeanX like the settlement
        failed. On timeout the payload is already stored and will be retried.
      */
      signal: AbortSignal.timeout(3000),
    });
  } catch (e) {
    throw new CapiError(e instanceof Error ? e.message : "network error reaching Meta", 0);
  }

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* A non-JSON body is only interesting when the call failed; on success the
       parse is not needed at all. */
  }

  if (!res.ok) {
    /* Meta's own wording, verbatim. Its errors name the offending parameter
       ("Invalid parameter: user_data.em"), which a flattened "HTTP 400" does
       not, and that name is the whole diagnosis. */
    const error = json.error as { message?: string; error_user_msg?: string } | undefined;
    throw new CapiError(
      error?.error_user_msg ?? error?.message ?? `HTTP ${res.status}`,
      res.status,
    );
  }

  return true;
}
