import "server-only";

import { unwiredAdapter, type ChannelAdapter } from "./types";

/*
  Shopee Open Platform — NOT WIRED YET.

  Blocked on Shopee Open Platform app approval (1–4 weeks), which also requires
  a live callback URL, so it is downstream of the kalima.my DNS cutover.

  When credentials arrive, this file gains:
    - authUrl      /api/v2/shop/auth_partner with the partner signature
    - exchangeCode /api/v2/auth/token/get      (code + shop_id -> tokens)
    - refresh      /api/v2/auth/access_token/get
  Shopee signs every request with HMAC-SHA256 over
  `partner_id + path + timestamp + access_token + shop_id`, so a shared signing
  helper lands here too, and the webhook verifier reuses it.

  Nothing else in the codebase needs to change when that happens — the
  connection table, token store, OAuth routes and admin surface are already
  built against the ChannelAdapter interface.
*/

const ENV_KEYS = ["SHOPEE_PARTNER_ID", "SHOPEE_PARTNER_KEY", "SHOPEE_REDIRECT_URI"] as const;

/*
  Whether the environment carries Shopee credentials. Distinct from
  `configured()`, which stays false until the adapter body above is written —
  so an operator who sets the variables gets "adapter not implemented" rather
  than the misleading "credentials missing".
*/
export function credentialsPresent(): boolean {
  return ENV_KEYS.every((k) => Boolean(process.env[k]));
}

export const shopeeAdapter: ChannelAdapter = unwiredAdapter("shopee");
