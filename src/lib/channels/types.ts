import "server-only";

/*
  The seam between Kalima and the external platforms (Phases 8 and 9).

  WHY THIS EXISTS. Neither Shopee, TikTok nor Meta has issued credentials yet,
  and none publishes a sandbox we can reach without one. Writing their HTTP
  clients now would mean guessing request shapes, response envelopes and error
  formats — exactly what cost a debugging cycle on LeanX's bank-name field,
  where the service label turned out to live under `name` rather than the
  documented `payment_service_name`.

  So everything that does NOT depend on a vendor's contract — the connection
  table, the OAuth round trip, token refresh, the admin surface, and later the
  stock ledger and inbox plumbing — is built and tested against this interface.
  Each adapter's HTTP body is written when its credentials and sandbox arrive.
  At that point the remaining work is one file, not a feature.

  NULL UNTIL CONFIGURED. An adapter whose environment variables are unset
  reports `configured() === false` and throws from every network method. It
  never returns a plausible-looking fake, for the same reason the payment
  webhook has no mock success path: a fake success is indistinguishable from a
  real one until money or stock is already wrong.
*/

export type Channel = "shopee" | "tiktok" | "whatsapp" | "instagram" | "facebook";

export const CHANNELS: readonly Channel[] = [
  "shopee",
  "tiktok",
  "whatsapp",
  "instagram",
  "facebook",
] as const;

export function isChannel(value: unknown): value is Channel {
  return typeof value === "string" && (CHANNELS as readonly string[]).includes(value);
}

/*
  The Meta family. Grouped because they share one app, one signing secret, one
  verify token and one Business verification — and because all three take a
  permanent token from the environment instead of an OAuth round trip, which is
  what lets one connect action and one button serve all of them.

  Lives here rather than in meta.ts so client components can narrow to it
  without importing a server-only module.
*/
export type MetaMessagingChannel = "whatsapp" | "instagram" | "facebook";

const META_MESSAGING_CHANNELS: readonly MetaMessagingChannel[] = [
  "whatsapp",
  "instagram",
  "facebook",
];

export function isMetaMessagingChannel(channel: Channel): channel is MetaMessagingChannel {
  return (META_MESSAGING_CHANNELS as readonly string[]).includes(channel);
}

export const CHANNEL_LABEL: Record<Channel, string> = {
  shopee: "Shopee",
  tiktok: "TikTok Shop",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook Page",
};

/*
  What a channel is FOR. Shopee and TikTok carry inventory; the Meta channels
  carry conversations. TikTok does both — TikTok Shop for stock and orders,
  TikTok Business Messaging for DMs — but they are one authorization from the
  merchant's side, so it is one connection with two capabilities.

  The admin surface reads this to decide which cards and controls a channel
  gets, so it is live information rather than documentation.
*/
export type ChannelCapability = "stock_sync" | "messaging";

export const CHANNEL_CAPABILITIES: Record<Channel, readonly ChannelCapability[]> = {
  shopee: ["stock_sync", "messaging"],
  tiktok: ["stock_sync", "messaging"],
  whatsapp: ["messaging"],
  instagram: ["messaging"],
  facebook: ["messaging"],
};

export function channelDoes(channel: Channel, capability: ChannelCapability): boolean {
  return CHANNEL_CAPABILITIES[channel].includes(capability);
}

/*
  The platform's reply window, in hours, after the customer's last inbound
  message. Outside it, free-text replies are rejected by the platform — so the
  composer must disable rather than let staff send into a void (Phase 9).
  `null` means the channel imposes none.
*/
export const REPLY_WINDOW_HOURS: Record<Channel, number | null> = {
  shopee: null,
  tiktok: 48,
  whatsapp: 24,
  instagram: 24,
  facebook: 24,
};

/*
  Per-channel CSRF cookie for the OAuth round trip. Namespaced by channel so
  two connections started in parallel cannot overwrite each other's proof — a
  shared cookie would make the second attempt silently invalidate the first.
*/
export function stateCookieName(channel: Channel): string {
  return `ch_oauth_state_${channel}`;
}

/** Raised when an adapter is asked to do real work without credentials. */
export class ChannelNotConfigured extends Error {
  readonly channel: Channel;
  constructor(channel: Channel) {
    super(
      `${CHANNEL_LABEL[channel]} is not configured — its API credentials are not set in the environment.`,
    );
    this.name = "ChannelNotConfigured";
    this.channel = channel;
  }
}

/** Raised when a token exchange or refresh fails upstream. */
export class ChannelTokenError extends Error {
  readonly channel: Channel;
  constructor(channel: Channel, message: string) {
    super(message);
    this.name = "ChannelTokenError";
    this.channel = channel;
  }
}

/*
  What an OAuth round trip yields. `expiresAt` is an absolute ISO timestamp:
  adapters convert whatever the platform returns (relative `expires_in`,
  absolute, seconds, milliseconds) at the boundary, so nothing downstream has
  to know which dialect a given vendor speaks. The EasyParcel integration
  learned this the same way — see `deriveExpiresAt` in lib/shipping/config.ts.
*/
export type TokenPair = {
  access: string;
  refresh: string;
  expiresAt: string;
  /** The platform's own id for the authorized shop/page/number, if it says. */
  externalShopId?: string | null;
  /** Human-readable account name for the admin card, if it says. */
  shopName?: string | null;
  scopes?: string[] | null;
};

/** One listing's stock, as the worker hands it to an adapter. */
export type StockPush = {
  externalItemId: string;
  externalModelId: string | null;
  /** Already net of the safety buffer and floored at zero. */
  qty: number;
};

/** A marketplace order, normalized out of whatever shape the platform sent. */
export type ChannelOrderInput = {
  externalOrderId: string;
  status: string | null;
  buyerName: string | null;
  totalSen: number | null;
  orderedAt: string | null;
  items: {
    externalItemId: string;
    externalModelId: string | null;
    qty: number;
    unitPriceSen: number | null;
  }[];
};

/*
  The contract every platform adapter satisfies.

  Grows one phase at a time, and only once something calls it. The OAuth surface
  came first because the connect flow needed it; stock push and webhook handling
  arrive now because the worker and the inbound route need them. Message
  send/receive lands with Phase 9. Declaring signatures for calls no code makes
  yet would be the same guess this seam exists to avoid.
*/
export interface ChannelAdapter {
  readonly channel: Channel;

  /*
    False while this adapter is still a stub awaiting a vendor contract.

    Distinct from configured(), which asks whether the credentials are present.
    Both answer "you cannot connect", but for opposite reasons and to opposite
    people: an unwired adapter is development work, an unconfigured one is a
    variable somebody needs to paste into Vercel. Collapsing the two is what
    told us WhatsApp's adapter "has not been implemented yet" while it sat
    there fully written, with a phone id missing from the environment.
  */
  readonly wired: boolean;

  /*
    Env var names this adapter needs and cannot currently see, so the admin
    screen can name them instead of saying "not configured" and leaving someone
    to guess which of six. Names only — never values.
  */
  missingEnv(): readonly string[];

  /*
    Look up a sender's display name, for platforms that omit it from the webhook.

    Separate from parseMessageWebhook because that is synchronous by contract
    and this is a network call. The route invokes it only when a thread still
    has no handle, so an established conversation costs nothing.

    MUST return null rather than throw on any failure. A rate limit, a deleted
    account or a user who blocked the Page are all ordinary; none of them is a
    reason to drop the customer's message, which is what an exception here would
    do. The thread keeps showing the scoped id and a later message tries again.
  */
  resolveHandle(externalUserId: string): Promise<string | null>;

  /** True when the environment carries this platform's credentials. */
  configured(): boolean;
  /** Where to send the merchant to authorize. `state` is opaque CSRF proof. */
  authUrl(state: string): string;
  /** Exchange the callback code for a token pair. */
  exchangeCode(code: string): Promise<TokenPair>;
  /** Trade a refresh token for a fresh pair. */
  refresh(refreshToken: string): Promise<TokenPair>;

  /*
    Set a listing's available quantity on the platform.

    Absolute, never a delta: a delta assumes both sides agreed on the previous
    figure, and the whole point of a reconciliation poll is that sometimes they
    do not.
  */
  pushStock(push: StockPush): Promise<void>;

  /*
    Authenticate an inbound webhook against the RAW body.

    Raw, because every platform signs the exact bytes it sent — re-serializing
    parsed JSON changes key order and whitespace and invalidates the signature.
    lib/payments/leanx.ts learned the same lesson.

    Must return false rather than throw when the signature is absent or wrong,
    so the route can answer 401 without leaking which of the two it was.
  */
  verifyWebhook(rawBody: string, headers: Headers): boolean;

  /*
    Normalize a verified webhook payload into orders. Returns an empty array for
    payloads that are valid but carry no order (heartbeats, status pings), which
    is not an error.
  */
  parseWebhook(body: unknown): ChannelOrderInput[];

  /*
    Echo a subscription handshake. Meta verifies a webhook URL by GETting it with
    hub.mode / hub.verify_token / hub.challenge and expecting the challenge
    echoed back; the marketplaces have equivalents. Returns the string to echo,
    or null to refuse — refusing is the default, so an unwired adapter can never
    have a webhook subscribed to it.
  */
  verifySubscription(params: URLSearchParams): string | null;

  /*
    Normalize a verified webhook payload into inbound messages. Separate from
    parseWebhook because the same signature scheme carries both order events and
    message events, and only the payload shape differs.
  */
  parseMessageWebhook(body: unknown): InboundMessage[];

  /*
    Send a free-text reply. Callers must check the reply window FIRST — see
    lib/channels/inbox.ts. An adapter may assume the window is open; it is not
    the adapter's job to re-derive policy from a timestamp.
  */
  sendMessage(input: OutboundMessage): Promise<{ externalMessageId: string | null }>;
}

/** An inbound message, normalized out of whatever shape the platform sent. */
export type InboundMessage = {
  externalThreadId: string;
  externalMessageId: string | null;
  externalUserId: string | null;
  externalHandle: string | null;
  body: string | null;
  attachments: { url: string; mime: string | null; name: string | null }[];
  sentAt: string | null;
  /* Used once, on first contact, to link a customer record. */
  contactPhone: string | null;
  contactEmail: string | null;
};

export type OutboundMessage = {
  externalThreadId: string;
  externalUserId: string | null;
  body: string;
};

/*
  Shared by every adapter that has not been wired yet. Keeping one
  implementation means an unconfigured channel behaves identically across
  platforms, and wiring a real one is a matter of replacing the methods rather
  than remembering the failure conventions.
*/
export function unwiredAdapter(channel: Channel): ChannelAdapter {
  const notConfigured = (): never => {
    throw new ChannelNotConfigured(channel);
  };
  return {
    channel,
    wired: false,
    /* Nothing to name: the blocker is unwritten code, not a missing variable. */
    missingEnv: () => [],
    /* No credentials, so no lookup. Null, not a throw — see the contract. */
    resolveHandle: async () => null,
    configured: () => false,
    authUrl: notConfigured,
    exchangeCode: notConfigured,
    refresh: notConfigured,
    pushStock: notConfigured,
    /*
      FAILS CLOSED. An unwired adapter cannot authenticate anything, so it
      authenticates nothing — returning true here would leave the inbound routes
      accepting unsigned payloads that move real stock and post real messages.
    */
    verifyWebhook: () => false,
    parseWebhook: notConfigured,
    /* Also fails closed: refusing the handshake means an unwired adapter can
       never have a live webhook subscription pointed at it. */
    verifySubscription: () => null,
    parseMessageWebhook: notConfigured,
    sendMessage: notConfigured,
  };
}
