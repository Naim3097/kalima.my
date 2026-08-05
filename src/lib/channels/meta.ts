import "server-only";

import crypto from "node:crypto";

import {
  ChannelNotConfigured,
  unwiredAdapter,
  type Channel,
  type ChannelAdapter,
  type InboundMessage,
  type OutboundMessage,
  type TokenPair,
} from "./types";

/*
  Meta — WhatsApp Cloud API, Instagram DM and Facebook Page messages.

  WhatsApp is WIRED. Instagram and Facebook are not: they additionally require
  Meta App Review for `instagram_business_manage_messages` and `pages_messaging`
  (2–4 weeks), which has not been applied for. They keep the unwired adapter and
  so continue to fail closed.

  All three sit behind ONE Meta app, one Business verification and one signing
  secret, which is why they share this file. The primitives below — signature
  verification and the subscription handshake — are already correct for all
  three; Instagram and Facebook need only their own parse and send when their
  review lands.

  See INSTRUCTION.md §2 for the account setup this expects.
*/

const APP_ID = process.env.META_APP_ID ?? "";
const APP_SECRET = process.env.META_APP_SECRET ?? "";
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN ?? "";
const WHATSAPP_PHONE_ID = process.env.META_WHATSAPP_PHONE_ID ?? "";
const WHATSAPP_TOKEN = process.env.META_WHATSAPP_TOKEN ?? "";

/*
  Pinned deliberately. Meta deprecates Graph versions on a schedule, and an
  unpinned URL means the payload shape can change under a running store without
  a deploy. Bump it consciously, after reading the changelog.
*/
const GRAPH_VERSION = "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

const ENV_KEYS = ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI"] as const;

/** See the note on shopee.ts:credentialsPresent — same distinction. */
export function credentialsPresent(): boolean {
  return ENV_KEYS.every((k) => Boolean(process.env[k]));
}

/* -------------------------------------------------------------------------
   Shared Meta primitives — correct for all three surfaces
   ------------------------------------------------------------------------- */

/*
  Meta signs the RAW request body with HMAC-SHA256 keyed on the app secret, and
  presents it as `x-hub-signature-256: sha256=<hex>`.

  Raw, because re-serializing parsed JSON changes key order and whitespace and
  invalidates the digest. The route reads request.text() before any parse for
  exactly this reason.

  FAILS CLOSED on every path: missing secret, missing header, malformed header,
  wrong length, mismatch. Returns false rather than throwing, so the route can
  answer 401 without leaking which of those it was.
*/
export function verifyMetaSignature(rawBody: string, headers: Headers): boolean {
  if (!APP_SECRET) return false;

  const presented = headers.get("x-hub-signature-256") ?? "";
  if (!presented.startsWith("sha256=")) return false;

  const expected =
    "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(rawBody, "utf8").digest("hex");

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on mismatched lengths, so check first.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/*
  The subscription handshake. Meta GETs the webhook URL with hub.mode=subscribe,
  hub.verify_token and hub.challenge, and expects the challenge echoed as the
  RAW body with a 200 — a JSON wrapper fails verification. The route returns it
  as text/plain; this function only decides whether to.

  Returns null to refuse, which is what an unset verify token does.
*/
export function verifyMetaSubscription(params: URLSearchParams): string | null {
  if (!VERIFY_TOKEN) return null;
  if (params.get("hub.mode") !== "subscribe") return null;

  const presented = params.get("hub.verify_token") ?? "";
  const a = Buffer.from(presented);
  const b = Buffer.from(VERIFY_TOKEN);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  return params.get("hub.challenge");
}

/* -------------------------------------------------------------------------
   WhatsApp
   ------------------------------------------------------------------------- */

/*
  WhatsApp Cloud API for a SINGLE business does not use an OAuth round trip.
  Meta's Embedded Signup exists for BSPs onboarding many merchants; Kalima is
  one store with one WABA, so the credential is a permanent System User access
  token pasted into the environment — the same shape decision EasyParcel forced,
  where the reference integration was multi-tenant and this store is not.

  So authUrl/exchangeCode/refresh are not reachable paths. They throw something
  that tells the reader what to do instead, rather than a generic
  "not configured" that would send someone hunting for a missing variable.
*/
function notAnOauthChannel(): never {
  throw new ChannelNotConfigured("whatsapp");
}

type WaValue = {
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: { profile?: { name?: string }; wa_id?: string }[];
  messages?: WaMessage[];
  statuses?: unknown[];
};

type WaMessage = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: WaMedia;
  video?: WaMedia;
  audio?: WaMedia;
  document?: WaMedia & { filename?: string };
  sticker?: WaMedia;
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
  reaction?: { emoji?: string };
};

type WaMedia = { id?: string; mime_type?: string; caption?: string };

/*
  wa_id arrives WITHOUT a leading '+' ("60123456789"), while profiles.phone
  stores E.164 WITH it ("+60123456789"). Without this the customer auto-link
  silently never matches, and every WhatsApp thread would show as an unknown
  sender even for existing customers.
*/
function toE164(waId: string | undefined): string | null {
  if (!waId) return null;
  const digits = waId.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : null;
}

/*
  Renders a non-text message as something a human can act on.

  A blank bubble is worse than a label: staff need to know a customer sent a
  photo even before media mirroring exists, so they can open WhatsApp if they
  must. Captions are preferred where present, because that is the customer's
  own words.
*/
function bodyOf(m: WaMessage): string | null {
  switch (m.type) {
    case "text":
      return m.text?.body ?? null;
    case "image":
      return m.image?.caption ?? "[photo]";
    case "video":
      return m.video?.caption ?? "[video]";
    case "audio":
      return "[voice message]";
    case "document":
      return m.document?.caption ?? `[document${m.document?.filename ? `: ${m.document.filename}` : ""}]`;
    case "sticker":
      return "[sticker]";
    case "location":
      return "[location]";
    case "button":
      return m.button?.text ?? "[button reply]";
    case "interactive":
      return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "[selection]";
    case "reaction":
      return m.reaction?.emoji ? `[reacted ${m.reaction.emoji}]` : "[reaction]";
    default:
      return m.type ? `[${m.type}]` : null;
  }
}

/*
  Media arrives as an ID, not a URL — resolving it needs a second authenticated
  call, and the resulting URL is short-lived. So the id and mime are recorded
  now and the bytes are mirrored later; see the deferred list in INSTRUCTION.md.
  Recording the id keeps that possible; dropping it would not.
*/
function attachmentsOf(m: WaMessage): InboundMessage["attachments"] {
  const media =
    m.image ?? m.video ?? m.audio ?? m.document ?? m.sticker ?? undefined;
  if (!media?.id) return [];
  return [
    {
      // Not a fetchable URL yet — a Graph media id. Named honestly.
      url: `whatsapp-media:${media.id}`,
      mime: media.mime_type ?? null,
      name: (m.document as { filename?: string } | undefined)?.filename ?? null,
    },
  ];
}

export function parseWhatsAppWebhook(body: unknown): InboundMessage[] {
  const payload = body as { entry?: { changes?: { value?: WaValue }[] }[] };
  const out: InboundMessage[] = [];

  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      /*
        Delivery and read receipts arrive under the SAME field ("messages") but
        carry `statuses` instead of `messages`. Returning [] for those is
        correct and routine — the route treats an empty array as valid traffic,
        not an error. Mistaking a receipt for a message would post the
        customer's own text back into the thread a second time.
      */
      if (!value?.messages?.length) continue;

      const contact = value.contacts?.[0];
      const handle = contact?.profile?.name ?? null;

      for (const m of value.messages) {
        if (!m.id || !m.from) continue;
        const seconds = Number.parseInt(m.timestamp ?? "", 10);
        out.push({
          // The customer's wa_id is the thread: one conversation per person.
          externalThreadId: m.from,
          externalMessageId: m.id,
          externalUserId: m.from,
          externalHandle: handle,
          body: bodyOf(m),
          attachments: attachmentsOf(m),
          // Unix SECONDS as a string. Milliseconds would date every message to
          // 1970 and sort the inbox backwards.
          sentAt: Number.isFinite(seconds)
            ? new Date(seconds * 1000).toISOString()
            : null,
          contactPhone: toE164(m.from),
          contactEmail: null,
        });
      }
    }
  }

  return out;
}

async function sendWhatsAppMessage(
  input: OutboundMessage,
): Promise<{ externalMessageId: string | null }> {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) throw new ChannelNotConfigured("whatsapp");

  const res = await fetch(`${GRAPH}/${WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.externalThreadId,
      type: "text",
      // preview_url false: an unfurled link preview in a support reply is
      // noise, and it leaks which links we send to Meta's crawler.
      text: { preview_url: false, body: input.body },
    }),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => ({}))) as {
    messages?: { id?: string }[];
    error?: { message?: string; code?: number; error_subcode?: number };
  };

  if (!res.ok) {
    /*
      Surface Meta's own message. Their errors are specific and actionable —
      "Message failed to send because more than 24 hours have passed" is worth
      showing a staff member verbatim rather than flattening to "send failed".
    */
    throw new Error(json.error?.message ?? `WhatsApp send failed (${res.status})`);
  }

  return { externalMessageId: json.messages?.[0]?.id ?? null };
}

/*
  Confirms the configured token can actually see the configured phone number,
  and returns how Meta describes it. Used by the connect action so "Connected"
  on the admin card means a verified round trip rather than "someone pasted
  something into the environment".
*/
export async function verifyWhatsAppCredentials(): Promise<{
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
}> {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) throw new ChannelNotConfigured("whatsapp");

  const res = await fetch(
    `${GRAPH}/${WHATSAPP_PHONE_ID}?fields=display_phone_number,verified_name`,
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }, cache: "no-store" },
  );
  const json = (await res.json().catch(() => ({}))) as {
    display_phone_number?: string;
    verified_name?: string;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(json.error?.message ?? `Could not verify WhatsApp credentials (${res.status})`);
  }

  return {
    phoneNumberId: WHATSAPP_PHONE_ID,
    displayPhoneNumber: json.display_phone_number ?? null,
    verifiedName: json.verified_name ?? null,
  };
}

export const whatsappAdapter: ChannelAdapter = {
  channel: "whatsapp",

  /* Written and live against the Cloud API — see sendWhatsAppMessage below. */
  wired: true,

  /*
    All four are required to do anything useful: the secret authenticates
    inbound, the verify token completes the handshake, and the phone id plus
    token send. Reporting configured() on a partial set would produce a channel
    that accepts messages it cannot answer.
  */
  configured: () =>
    Boolean(APP_SECRET && VERIFY_TOKEN && WHATSAPP_PHONE_ID && WHATSAPP_TOKEN),

  /*
    Same four, named. A partial set is the likeliest state during setup —
    Meta hands these out from four different screens — so the admin screen
    should say which one is missing rather than make someone diff the list.
  */
  missingEnv: () =>
    (
      [
        ["META_APP_SECRET", APP_SECRET],
        ["META_VERIFY_TOKEN", VERIFY_TOKEN],
        ["META_WHATSAPP_PHONE_ID", WHATSAPP_PHONE_ID],
        ["META_WHATSAPP_TOKEN", WHATSAPP_TOKEN],
      ] as const
    )
      .filter(([, value]) => !value)
      .map(([name]) => name),

  authUrl: notAnOauthChannel,
  exchangeCode: notAnOauthChannel,
  refresh: (): Promise<TokenPair> => notAnOauthChannel(),

  // WhatsApp carries no stock.
  pushStock: () => {
    throw new ChannelNotConfigured("whatsapp");
  },
  parseWebhook: () => [],

  verifyWebhook: verifyMetaSignature,
  verifySubscription: verifyMetaSubscription,
  parseMessageWebhook: parseWhatsAppWebhook,
  sendMessage: sendWhatsAppMessage,
};

/* -------------------------------------------------------------------------
   Instagram + Facebook — awaiting Meta App Review
   ------------------------------------------------------------------------- */

/*
  Left unwired on purpose. Both need App Review approval that has not been
  applied for, and an adapter that authenticated payloads it could not parse or
  answer would be worse than one that refuses.

  When the review lands, each needs only parseMessageWebhook and sendMessage:
  verifyMetaSignature and verifyMetaSubscription above already serve them,
  since it is the same app and the same signing secret.
*/
export const instagramAdapter: ChannelAdapter = unwiredAdapter("instagram");
export const facebookAdapter: ChannelAdapter = unwiredAdapter("facebook");

/** The Meta-family channels, so callers can reason about the shared app. */
export const META_CHANNELS: readonly Channel[] = ["whatsapp", "instagram", "facebook"] as const;

/** Exposed for diagnostics — never log the secret itself. */
export const META_APP_CONFIGURED = Boolean(APP_ID && APP_SECRET);
