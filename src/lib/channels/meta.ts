import "server-only";

import { unwiredAdapter, type Channel, type ChannelAdapter } from "./types";

/*
  Meta — WhatsApp Cloud API, Instagram DM and Facebook Page messages.
  NOT WIRED YET.

  All three sit behind ONE Meta app and one Business verification, which is why
  they share this file: the OAuth round trip, the Graph API base and the
  signature scheme are identical, and only the scopes and message endpoints
  differ per surface.

  This is also the shortest path to a working inbox. Phase 5's WhatsApp
  broadcast already needs the same Meta Business verification, so that single
  approval unblocks both outbound campaigns and the inbound inbox — which is
  why WhatsApp is the agreed first channel to wire.

  When credentials arrive, this file gains:
    - authUrl      https://www.facebook.com/{version}/dialog/oauth with scopes
                   (whatsapp_business_messaging, instagram_business_manage_messages,
                   pages_messaging) per surface
    - exchangeCode GET /oauth/access_token -> short-lived, then exchanged for
                   a long-lived token; Meta returns no refresh token, so
                   `refresh` re-exchanges the long-lived one before expiry
    - webhook verification: HMAC-SHA256 over the RAW body, presented as
      `x-hub-signature-256`. The raw body must be read before any JSON parse,
      the same discipline lib/payments/leanx.ts already follows.

  Instagram and Facebook additionally require Meta App Review for
  `instagram_business_manage_messages` and `pages_messaging` (2–4 weeks), so
  they will come online after WhatsApp even once the app itself exists.
*/

const ENV_KEYS = ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI"] as const;

/** See the note on shopee.ts:credentialsPresent — same distinction. */
export function credentialsPresent(): boolean {
  return ENV_KEYS.every((k) => Boolean(process.env[k]));
}

export const whatsappAdapter: ChannelAdapter = unwiredAdapter("whatsapp");
export const instagramAdapter: ChannelAdapter = unwiredAdapter("instagram");
export const facebookAdapter: ChannelAdapter = unwiredAdapter("facebook");

/** The Meta-family channels, so callers can reason about the shared app. */
export const META_CHANNELS: readonly Channel[] = ["whatsapp", "instagram", "facebook"] as const;
