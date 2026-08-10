import "server-only";

import crypto from "node:crypto";

import {
  CHANNEL_LABEL,
  ChannelNotConfigured,
  type Channel,
  type ChannelAdapter,
  type InboundMessage,
  type MetaMessagingChannel,
  type OutboundMessage,
  type TokenPair,
} from "./types";

/*
  Meta — WhatsApp Cloud API, Instagram DM and Facebook Page messages.

  All three are wired. All three sit behind ONE Meta app, one Business
  verification and one signing secret, which is why they share this file:
  verifyMetaSignature and verifyMetaSubscription serve every surface unchanged.

  Instagram and Facebook still need Meta App Review for
  `instagram_business_manage_messages` and `pages_messaging` before they can
  message the public. That review requires a screencast of the feature working,
  so the code has to exist first — Standard Access lets it run against accounts
  holding a role on the app, which is enough to build, test and record. See
  INSTRUCTION.md §3.1; getting that order backwards costs a rejection.

  The two message formats are genuinely different and each has a trap that looks
  like the other's correct behaviour:

    WhatsApp   entry[].changes[].value.messages[]   timestamp in SECONDS
               receipts arrive as `statuses`
    IG / FB    entry[].messaging[]                  timestamp in MILLISECONDS
               our own replies arrive back as `is_echo`

  See INSTRUCTION.md §2 for the account setup this expects.
*/

const APP_ID = process.env.META_APP_ID ?? "";
const APP_SECRET = process.env.META_APP_SECRET ?? "";
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN ?? "";
const WHATSAPP_PHONE_ID = process.env.META_WHATSAPP_PHONE_ID ?? "";
const WHATSAPP_TOKEN = process.env.META_WHATSAPP_TOKEN ?? "";

/*
  Instagram and Facebook Page messaging.

  One Page access token serves both: Instagram professional accounts are
  addressed through the Page they are linked to, which is why there is no
  separate Instagram token here. Generate it for the same System User that holds
  the WhatsApp token, with `pages_messaging` and
  `instagram_business_manage_messages` and the Page assigned as an asset.

  PAGE_ID is the Facebook Page's numeric id; INSTAGRAM_ID is the Instagram
  professional account id (NOT the @handle, and not the Page id).
*/
const PAGE_ID = process.env.META_PAGE_ID ?? "";
const INSTAGRAM_ID = process.env.META_INSTAGRAM_ID ?? "";
const PAGE_TOKEN = process.env.META_PAGE_TOKEN ?? "";

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
   Instagram DM + Facebook Page messages
   ------------------------------------------------------------------------- */

/*
  Instagram and Messenger send the SAME webhook shape — the Messenger platform
  format — so one parser serves both. It is a different shape from WhatsApp's,
  which is why this is not simply reused:

    WhatsApp   entry[].changes[].value.messages[]
    IG / FB    entry[].messaging[]

  Written and testable NOW, before App Review. Standard Access covers accounts
  holding a role on the app, so this can be exercised end to end against
  Kalima's own Page and Instagram account — which is exactly what the review
  requires a screencast of. Submitting first and building after gets rejected;
  see INSTRUCTION.md §3.1.
*/
type MetaMessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    /*
      TRUE on messages the Page itself sent, echoed back to us.

      Skipping these is not optional. Every reply staff send from /admin/inbox
      comes straight back through this webhook, and recording it would file our
      own outbound message a second time as an inbound one — the customer would
      appear to have sent us our own words, and the 24-hour reply window would
      reset off our own traffic. WhatsApp's equivalent trap is `statuses`.
    */
    is_echo?: boolean;
    attachments?: {
      type?: string;
      payload?: { url?: string; title?: string };
    }[];
  };
  /* Delivery receipts, read receipts and postbacks arrive in the same array. */
  delivery?: unknown;
  read?: unknown;
  reaction?: { emoji?: string; action?: string };
  postback?: { title?: string; payload?: string };
};

/*
  Renders an attachment-only message as something a staff member can act on,
  for the same reason bodyOf does it for WhatsApp: a blank bubble hides the fact
  that a customer sent anything at all.

  `share` and `story_mention` are Instagram-specific and worth naming — a story
  mention is a common way customers start a conversation, and reading
  "[story mention]" tells staff to open Instagram rather than wonder.
*/
function messengerBodyOf(event: MetaMessagingEvent): string | null {
  const text = event.message?.text;
  if (text) return text;

  if (event.postback?.title) return event.postback.title;
  if (event.reaction?.emoji) return `[reacted ${event.reaction.emoji}]`;

  const first = event.message?.attachments?.[0];
  if (!first) return null;

  switch (first.type) {
    case "image":
      return "[photo]";
    case "video":
      return "[video]";
    case "audio":
      return "[voice message]";
    case "file":
      return "[file]";
    case "share":
      return first.payload?.title ? `[shared: ${first.payload.title}]` : "[shared post]";
    case "story_mention":
      return "[mentioned you in a story]";
    default:
      return first.type ? `[${first.type}]` : null;
  }
}

/*
  Unlike WhatsApp, these attachments arrive as real fetchable URLs rather than
  media ids. They are short-lived CDN links though, so they are recorded to be
  mirrored later rather than relied on — the same reasoning as the WhatsApp
  media ids, arrived at from the opposite direction.
*/
function messengerAttachmentsOf(event: MetaMessagingEvent): InboundMessage["attachments"] {
  return (event.message?.attachments ?? [])
    .filter((a) => a.payload?.url)
    .map((a) => ({
      url: a.payload!.url!,
      mime: null,
      name: a.payload?.title ?? null,
    }));
}

export function parseMessengerWebhook(body: unknown): InboundMessage[] {
  const payload = body as { entry?: { messaging?: MetaMessagingEvent[] }[] };
  const out: InboundMessage[] = [];

  for (const entry of payload?.entry ?? []) {
    for (const event of entry?.messaging ?? []) {
      /* Receipts are valid traffic carrying no message. Not an error. */
      if (event.delivery || event.read) continue;
      /* Our own reply, echoed back. See the note on is_echo. */
      if (event.message?.is_echo) continue;

      const senderId = event.sender?.id;
      if (!senderId) continue;

      const body = messengerBodyOf(event);
      const attachments = messengerAttachmentsOf(event);
      /* Nothing a human could read or open — a typing indicator, an unhandled
         event type. Recording an empty row would only clutter the thread. */
      if (!body && !attachments.length) continue;

      out.push({
        /* The sender is the thread: a PSID on Messenger, an IGSID on Instagram.
           Both are scoped to this app, so they are stable for us and useless to
           anyone else. */
        externalThreadId: senderId,
        externalMessageId: event.message?.mid ?? null,
        externalUserId: senderId,
        /*
          Not in the payload, and it cannot be fetched here: parseMessageWebhook
          is synchronous by contract. Resolving a display name needs a separate
          Graph call, so threads show the scoped id until someone adds that.
          Recorded as a known gap in INSTRUCTION.md §3.3 rather than guessed at.
        */
        externalHandle: null,
        body,
        attachments,
        /*
          MILLISECONDS here — WhatsApp sends SECONDS. Multiplying these by 1000
          would date every Instagram message to the year 57000 and sort the
          inbox to nonsense; the WhatsApp path has the mirror-image trap.
        */
        sentAt:
          typeof event.timestamp === "number" && Number.isFinite(event.timestamp)
            ? new Date(event.timestamp).toISOString()
            : null,
        /*
          Neither platform gives a phone or an email, so threads stay unlinked to
          a customer and staff link them by hand. Passing null is the honest
          answer; record_inbound_message handles it and retries on every inbound
          if a profile appears later.
        */
        contactPhone: null,
        contactEmail: null,
      });
    }
  }

  return out;
}

/*
  BOTH surfaces send through the PAGE id. Not the Instagram account's id, even
  for Instagram.

  This was wrong at first and Meta's error did not say so. Posting to
  {INSTAGRAM_ID}/messages returns "(#3) Application does not have the capability
  to make this API call" — which reads as a missing permission and sends you
  looking at scopes. The token had `instagram_manage_messages` the whole time.
  The same token, the same body and the same recipient IGSID succeed against
  {PAGE_ID}/messages, and the message arrives in Instagram.

  Which is the Messenger Platform model: an Instagram professional account is
  reached through the Page it is linked to, and the recipient id is what decides
  which surface the message lands on. META_INSTAGRAM_ID is therefore an identity
  we verify and display, never a send target.

  `messaging_type: "RESPONSE"` declares this as a reply to a user-initiated
  message, which is what keeps it inside the standard messaging window. Anything
  else needs a message tag and a separate policy justification, and Kalima sends
  neither.
*/
async function sendViaMessenger(
  channel: Exclude<MetaMessagingChannel, "whatsapp">,
  input: OutboundMessage,
): Promise<{ externalMessageId: string | null }> {
  if (!PAGE_TOKEN || !PAGE_ID) throw new ChannelNotConfigured(channel);

  const res = await fetch(`${GRAPH}/${PAGE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAGE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient: { id: input.externalThreadId },
      message: { text: input.body },
      messaging_type: "RESPONSE",
    }),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => ({}))) as {
    message_id?: string;
    error?: { message?: string };
  };

  if (!res.ok) {
    /* Meta's wording again — "This message is sent outside of allowed window"
       is worth a staff member seeing verbatim. */
    throw new Error(json.error?.message ?? `${CHANNEL_LABEL[channel]} send failed (${res.status})`);
  }

  /* Note `message_id`, singular and top-level — WhatsApp answers with
     `messages[0].id`. Same company, different shape. */
  return { externalMessageId: json.message_id ?? null };
}

/*
  Confirms the Page token can actually see the id it is configured with, so
  "Connected" in the admin means a verified round trip rather than a pasted
  value — the same standard verifyWhatsAppCredentials sets.
*/
export async function verifyMetaMessagingCredentials(
  channel: Exclude<MetaMessagingChannel, "whatsapp">,
): Promise<{ id: string; name: string | null }> {
  const id = channel === "instagram" ? INSTAGRAM_ID : PAGE_ID;
  if (!PAGE_TOKEN || !id) throw new ChannelNotConfigured(channel);

  const fields = channel === "instagram" ? "username,name" : "name";
  const res = await fetch(`${GRAPH}/${id}?fields=${fields}`, {
    headers: { Authorization: `Bearer ${PAGE_TOKEN}` },
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    name?: string;
    username?: string;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      json.error?.message ?? `Could not verify the ${CHANNEL_LABEL[channel]} credentials (${res.status})`,
    );
  }

  return { id, name: json.username ? `@${json.username}` : (json.name ?? null) };
}

function notAnOauthMessagingChannel(channel: Channel): never {
  /*
    Same shape as WhatsApp: the credential is a Page token from the environment,
    not an OAuth round trip. Kalima owns its own Page; the OAuth dance exists for
    software connecting Pages it does not own.
  */
  throw new ChannelNotConfigured(channel);
}

function messengerAdapter(
  channel: Exclude<MetaMessagingChannel, "whatsapp">,
  idVarName: string,
  id: string,
): ChannelAdapter {
  return {
    channel,
    wired: true,

    /*
      PAGE_ID is required by BOTH channels, because both send through the Page —
      see sendViaMessenger. Instagram additionally needs its own id, which is
      what the connect check verifies and what the admin card displays.
    */
    configured: () => Boolean(APP_SECRET && VERIFY_TOKEN && id && PAGE_ID && PAGE_TOKEN),

    missingEnv: () => {
      const required: readonly (readonly [string, string])[] = [
        ["META_APP_SECRET", APP_SECRET],
        ["META_VERIFY_TOKEN", VERIFY_TOKEN],
        [idVarName, id],
        ["META_PAGE_ID", PAGE_ID],
        ["META_PAGE_TOKEN", PAGE_TOKEN],
      ];
      /* Deduped: for Facebook, idVarName IS META_PAGE_ID, and naming the same
         variable twice would read as two separate problems. */
      return [...new Set(required.filter(([, value]) => !value).map(([name]) => name))];
    },

    authUrl: () => notAnOauthMessagingChannel(channel),
    exchangeCode: () => notAnOauthMessagingChannel(channel),
    refresh: (): Promise<TokenPair> => notAnOauthMessagingChannel(channel),

    /* Neither carries stock. */
    pushStock: () => {
      throw new ChannelNotConfigured(channel);
    },
    parseWebhook: () => [],

    /* Shared with WhatsApp — one app, one signing secret, one verify token. */
    verifyWebhook: verifyMetaSignature,
    verifySubscription: verifyMetaSubscription,
    parseMessageWebhook: parseMessengerWebhook,
    sendMessage: (input) => sendViaMessenger(channel, input),
  };
}

export const instagramAdapter: ChannelAdapter = messengerAdapter(
  "instagram",
  "META_INSTAGRAM_ID",
  INSTAGRAM_ID,
);
export const facebookAdapter: ChannelAdapter = messengerAdapter(
  "facebook",
  "META_PAGE_ID",
  PAGE_ID,
);

/** The Meta-family channels, so callers can reason about the shared app. */
export const META_CHANNELS: readonly Channel[] = ["whatsapp", "instagram", "facebook"] as const;

/** Exposed for diagnostics — never log the secret itself. */
export const META_APP_CONFIGURED = Boolean(APP_ID && APP_SECRET);
