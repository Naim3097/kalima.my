"use client";

import { trackEvent } from "@/app/analytics/actions";
import type { CapiEvent } from "@/lib/meta/events";

/*
  The one line a component writes to report an event.

  FIRE AND FORGET, AND NEVER AWAITED BY A HANDLER. Every call site here is
  either a render effect or a click that does something the shopper is waiting
  on — adding to the bag, opening the drawer. An ads event must never sit
  between the click and the thing the click does, and a failed one must never
  surface. So the promise is dropped on purpose and the rejection swallowed.

  Deliberately not a hook: `addToBag` and the wishlist toggle are plain handlers,
  and a hook would force a component to restructure around something that is not
  part of what it does.
*/
export function track(
  event: CapiEvent,
  detail: { items?: { slug: string; qty?: number }[]; searchString?: string } = {},
): void {
  void trackEvent({
    event,
    ...detail,
    /* The path only. The origin is the server's to supply — a client that could
       name it could write another site's address into the shop's reporting. */
    path: typeof window === "undefined" ? undefined : window.location.pathname,
  }).catch(() => {});
}
