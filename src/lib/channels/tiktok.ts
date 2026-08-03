import "server-only";

import { unwiredAdapter, type ChannelAdapter } from "./types";

/*
  TikTok Shop Open Platform + TikTok Business Messaging — NOT WIRED YET.

  Blocked on TikTok Shop Partner Center app approval, and separately on
  Business Messaging API access. Both are one merchant authorization from
  Kalima's side, which is why this is a single channel with two capabilities
  (see CHANNEL_CAPABILITIES in ./types).

  When credentials arrive, this file gains:
    - authUrl      Partner Center service auth URL
    - exchangeCode /api/v2/token/get
    - refresh      /api/v2/token/refresh
  TikTok signs with HMAC-SHA256 over a sorted-parameter string, so the signing
  helper lands here and is shared with the webhook verifier.

  Note for whoever wires this: TikTok's reply window is 48h, not the 24h the
  Meta channels use — REPLY_WINDOW_HOURS in ./types already encodes that, and
  the inbox composer reads it rather than hardcoding a number.
*/

const ENV_KEYS = ["TIKTOK_APP_KEY", "TIKTOK_APP_SECRET", "TIKTOK_REDIRECT_URI"] as const;

/** See the note on shopee.ts:credentialsPresent — same distinction. */
export function credentialsPresent(): boolean {
  return ENV_KEYS.every((k) => Boolean(process.env[k]));
}

export const tiktokAdapter: ChannelAdapter = unwiredAdapter("tiktok");
