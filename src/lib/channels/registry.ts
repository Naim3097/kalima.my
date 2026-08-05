import "server-only";

import { shopeeAdapter, credentialsPresent as shopeeCreds } from "./shopee";
import { tiktokAdapter, credentialsPresent as tiktokCreds } from "./tiktok";
import {
  whatsappAdapter,
  instagramAdapter,
  facebookAdapter,
  credentialsPresent as metaCreds,
} from "./meta";
import { CHANNEL_LABEL, type Channel, type ChannelAdapter } from "./types";

/*
  Adapter lookup. One place that knows which implementation serves a channel,
  so routes and jobs take a `Channel` string and never import a vendor module
  directly — that is what keeps adding a platform to one file.
*/

const ADAPTERS: Record<Channel, ChannelAdapter> = {
  shopee: shopeeAdapter,
  tiktok: tiktokAdapter,
  whatsapp: whatsappAdapter,
  instagram: instagramAdapter,
  facebook: facebookAdapter,
};

/* WhatsApp, Instagram and Facebook share one Meta app, so one credential set. */
const CREDENTIALS_PRESENT: Record<Channel, () => boolean> = {
  shopee: shopeeCreds,
  tiktok: tiktokCreds,
  whatsapp: metaCreds,
  instagram: metaCreds,
  facebook: metaCreds,
};

export function adapterFor(channel: Channel): ChannelAdapter {
  return ADAPTERS[channel];
}

/*
  Why a channel cannot be connected right now, or null when it can.

  Separating "no credentials" from "adapter not written yet" matters
  operationally: the first is something the client fixes by supplying keys, the
  second is development work. A single "not configured" message would send
  someone hunting for a missing environment variable that was never the
  problem.
*/
export function connectBlockedReason(channel: Channel): string | null {
  const adapter = adapterFor(channel);
  if (adapter.configured()) return null;

  const label = CHANNEL_LABEL[channel];

  /*
    Ask the adapter, not the credentials.

    This used to infer "adapter not written" from "credentials present but not
    configured", which was true only while every Meta channel was a stub. Once
    WhatsApp was wired, a half-filled environment started reporting itself as
    missing code — and the message sent someone looking through src/ for an
    adapter that had been finished and deployed for weeks. Exactly the wrong
    turn this function exists to prevent.
  */
  if (!adapter.wired) {
    return CREDENTIALS_PRESENT[channel]()
      ? `${label} credentials are set, but its API adapter has not been implemented yet — it is awaiting platform approval and a sandbox to build against.`
      : `${label} is not configured — its API credentials are not set in the environment.`;
  }

  const missing = adapter.missingEnv();
  if (!missing.length) {
    /* Wired, nothing missing, still not configured: the adapter's own rule
       refused it. Say so plainly rather than blame the environment. */
    return `${label} is not ready — its adapter reports an incomplete configuration.`;
  }

  return `${label} is not connected — ${
    missing.length === 1 ? "this variable is" : "these variables are"
  } not set on this environment: ${missing.join(", ")}. Add ${
    missing.length === 1 ? "it" : "them"
  } in Vercel and redeploy (they are read at module load).`;
}

/** Channels that can actually complete an OAuth round trip today. */
export function connectableChannels(): Channel[] {
  return (Object.keys(ADAPTERS) as Channel[]).filter((c) => ADAPTERS[c].configured());
}
