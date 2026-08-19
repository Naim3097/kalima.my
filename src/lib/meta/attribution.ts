import "server-only";

import { cookies, headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import type { CapiIdentity } from "@/lib/meta/capi";

/*
  The bridge between a shopper's live request and an order that settles later.

  Meta matches a server event on who the person is AND on the device they were
  using. The second half only exists during the request the shopper themselves
  made — their IP, their User-Agent, and the two cookies src/proxy.ts minted for
  them. A payment webhook has none of it: it is LeanX calling us, carrying
  LeanX's address, LeanX's user agent and no cookies at all.

  So the shape here is capture-then-replay. `captureAttribution` runs inside
  placeOrder, while the shopper is still on the line. `identityFromOrder` reads
  it back when the money lands.
*/

export type CapturedAttribution = {
  fbp: string | null;
  fbc: string | null;
  ip: string | null;
  userAgent: string | null;
};

/*
  Reads the four values off the current request.

  Every one of them is legitimately absent sometimes — a first visit before the
  proxy's Set-Cookie has come back, a shopper who arrived without ever clicking
  an ad, a client that sends no User-Agent. Null is the honest answer, and Meta
  drops absent fields rather than being harmed by them.
*/
export async function readAttribution(): Promise<CapturedAttribution> {
  const [jar, h] = await Promise.all([cookies(), headers()]);

  return {
    fbp: jar.get("_fbp")?.value ?? null,
    fbc: jar.get("_fbc")?.value ?? null,
    /* Same resolution order as callerKey in src/lib/rate-limit.ts. The first
       entry of x-forwarded-for is the client; the rest are proxies. */
    ip:
      h.get("x-real-ip") ??
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      null,
    userAgent: h.get("user-agent"),
  };
}

/*
  Stamps the order with what the request knew.

  BEST EFFORT, ALWAYS. This runs immediately after an order row exists and the
  customer is about to be sent to a payment page. A failure here costs the shop
  some attribution quality on one conversion; a throw here would cost it the
  order. The order is the more important of the two by a distance.
*/
export async function captureAttribution(orderId: string): Promise<void> {
  try {
    const client = createAdminClient();
    if (!client) return;

    const captured = await readAttribution();
    /* Nothing worth writing — do not spend a round trip saying so. */
    if (!captured.fbp && !captured.fbc && !captured.ip && !captured.userAgent) return;

    await client
      .from("orders")
      .update({
        capi_fbp: captured.fbp,
        capi_fbc: captured.fbc,
        capi_client_ip: captured.ip,
        capi_client_ua: captured.userAgent,
      })
      .eq("id", orderId);
  } catch {
    /* Deliberately silent. See above. */
  }
}

/** The order columns this module reads back. */
export type AttributedOrder = {
  email: string | null;
  phone: string | null;
  user_id: string | null;
  shipping_address: Record<string, unknown> | null;
  capi_fbp: string | null;
  capi_fbc: string | null;
  capi_client_ip: string | null;
  capi_client_ua: string | null;
};

/*
  Everything Meta may know about the buyer, assembled from the order.

  The name is split on the first space because the checkout collects one
  "recipient" field, not two. Meta hashes `fn` and `ln` separately, so a single
  field hashed whole would match nobody — "Nurul Aisyah" is not a first name.
  A single-word name yields a first name and no last name, which is correct
  rather than a gap to fill with an empty string.
*/
export function identityFromOrder(order: AttributedOrder): CapiIdentity {
  const address = (order.shipping_address ?? {}) as Record<string, string | undefined>;
  const recipient = (address.recipient ?? "").trim();
  const space = recipient.indexOf(" ");

  return {
    email: order.email,
    /* The address phone is the one the courier will ring, and the order phone
       is the one the shopper typed; they are usually the same and either is a
       better match than nothing. */
    phone: order.phone ?? address.phone ?? null,
    firstName: space === -1 ? recipient || null : recipient.slice(0, space),
    lastName: space === -1 ? null : recipient.slice(space + 1),
    city: address.city ?? null,
    state: address.state ?? null,
    postcode: address.postcode ?? null,
    country: address.country ?? null,
    externalId: order.user_id,
    fbp: order.capi_fbp,
    fbc: order.capi_fbc,
    ip: order.capi_client_ip,
    userAgent: order.capi_client_ua,
  };
}

/** The select list for the columns above, so callers cannot drift from the type. */
export const ATTRIBUTED_ORDER_COLUMNS =
  "email, phone, user_id, shipping_address, capi_fbp, capi_fbc, capi_client_ip, capi_client_ua";
