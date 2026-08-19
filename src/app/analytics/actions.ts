"use server";

import { allow, callerKey } from "@/lib/rate-limit";
import { trackBrowserEvent, type TrackInput } from "@/lib/meta/browser";

/*
  The browser's only way into the Conversions API.

  A SERVER ACTION RATHER THAN A ROUTE HANDLER, deliberately. Next validates the
  Origin against the Host for every action call, so this gets CSRF protection
  that a public POST endpoint would have to hand-roll — and it matches how the
  rest of the checkout already talks to the server.

  Whatever arrives here is a claim, not a fact. Three things keep a claim from
  becoming reported revenue:

    - the event name is checked against an allowlist that excludes Purchase and
      AddPaymentInfo, so a page can never assert a sale;
    - prices are looked up from the catalogue, never taken from the caller, so
      a scripted request cannot inflate the shop's own conversion values;
    - the throttle below makes volume tedious.

  The throttle is a speed bump and its own module says so — per-instance, lost
  on redeploy. What it stops is one caller in a loop, which is the abuse an
  analytics endpoint actually attracts. Thirty a minute is far more than a
  person browsing generates and far less than a script wants.
*/
export async function trackEvent(input: TrackInput): Promise<void> {
  if (!allow(await callerKey("capi"), 30, 60_000)) return;

  /* Never awaited by the caller for its result — see the client helper. A
     failure here is invisible by design; nothing on the storefront depends on
     an ads event having been delivered. */
  await trackBrowserEvent(input);
}
