import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { buildEvent, capiConfigured, type CapiIdentity } from "@/lib/meta/capi";
import { sendDurable } from "@/lib/meta/dead-letter";
import { toMajorUnit } from "@/lib/meta/events";
import { ATTRIBUTED_ORDER_COLUMNS, identityFromOrder, type AttributedOrder } from "@/lib/meta/attribution";

/*
  The two events that carry money: Purchase and AddPaymentInfo.

  Both are built entirely from the order row. NOTHING HERE MAY READ headers()
  OR cookies(), and that is not a stylistic preference.

  runPaidSideEffects has three callers with three different request contexts:
  the payment webhook (settle.ts — the request belongs to LeanX, in a
  datacentre), reconcileOrderPayment (commerce.ts — the request belongs to the
  shopper's own browser, arriving via the return page), and the expiry cron (no
  browser at all). Reading the live request "when available" would therefore
  produce a dataset where some conversions carry the shopper's device and some
  carry a payment gateway's, decided by whether a callback happened to arrive
  before a redirect. It would look correct in testing, every time.

  So the shopper's IP, User-Agent and Meta cookies come from the snapshot taken
  in placeOrder while they were actually on the line. See src/lib/meta/attribution.ts.
*/

/*
  The site's origin, with any trailing slash removed.

  NOT COSMETIC. These values are typed into a dashboard by a person, and
  "https://www.kalima.my/" is at least as natural to write as the bare origin.
  Left alone it composes "https://www.kalima.my//products/serra-scallop", and
  Meta answers a double slash by discarding the path — every event then reports
  the homepage, which silently breaks URL-based custom audiences ("people who
  viewed a product page") while the events themselves still say Processed.
  Found exactly that way, in Test Events, after everything else looked right.
*/
const BASE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://www.kalima.my"
).replace(/\/+$/, "");

type OrderRow = AttributedOrder & {
  id: string;
  reference: string;
  currency: string | null;
  total_sen: number;
  created_at: string;
};

type OrderItemRow = {
  qty: number;
  unit_price_sen: number;
  product_variants: { products: { slug: string } | null } | null;
};

/*
  Reads everything both events need in one round trip.

  content_ids comes through the FK on order_items rather than a denormalised
  column: order_items.product_variant_id is `not null references
  product_variants(id)`, so the slug is always reachable, and duplicating it on
  the line would be a second snapshot that can disagree with the first.
*/
async function loadOrder(
  orderId: string,
): Promise<{ order: OrderRow; items: OrderItemRow[] } | null> {
  const client = createAdminClient();
  if (!client) return null;

  const { data, error } = await client
    .from("orders")
    .select(
      `id, reference, currency, total_sen, created_at, ${ATTRIBUTED_ORDER_COLUMNS},
       order_items ( qty, unit_price_sen, product_variants ( products ( slug ) ) )`,
    )
    .eq("id", orderId)
    .single();

  if (error || !data) return null;

  const { order_items, ...order } = data as unknown as OrderRow & { order_items: OrderItemRow[] | null };
  return { order, items: order_items ?? [] };
}

/*
  `contents` and `content_ids` in the shape Meta's catalogue tools expect.

  THE ID IS THE PRODUCT SLUG, and that choice is a one-way door: whatever is
  sent now must match the `id` column of any product feed uploaded to Meta
  later, or none of this history can be joined to it. The slug is chosen because
  it is already the identity the whole checkout uses, it is stable across
  renames, and a person reading Events Manager can tell what it is.
*/
function contentsFrom(items: OrderItemRow[]) {
  const contents = items
    .map((i) => ({
      id: i.product_variants?.products?.slug,
      quantity: i.qty,
      item_price: toMajorUnit(i.unit_price_sen),
    }))
    .filter((c): c is { id: string; quantity: number; item_price: number } => Boolean(c.id));

  return {
    contents,
    content_ids: contents.map((c) => c.id),
    content_type: "product",
    num_items: contents.reduce((n, c) => n + c.quantity, 0),
  };
}

function identityFor(order: OrderRow): CapiIdentity {
  return identityFromOrder(order);
}

/*
  Purchase — the event the whole integration exists for.

  event_id is the ORDER REFERENCE, deliberately. Meta deduplicates on
  (event_name, event_id) for 48 hours, so a retry of a send whose response was
  lost is collapsed rather than counted as a second sale. A random id here would
  turn every recovered failure into phantom revenue.

  event_time is when the order was CREATED, not when this runs. A settlement can
  arrive minutes after the checkout, and Meta attributes on event_time — dating
  it now would drift every conversion later than it happened, and would make a
  retried event claim a different moment than the original.
*/
export async function sendPurchase(orderId: string): Promise<void> {
  if (!capiConfigured()) return;

  try {
    const loaded = await loadOrder(orderId);
    if (!loaded) return;
    const { order, items } = loaded;

    const event = buildEvent({
      event: "Purchase",
      eventId: order.reference,
      eventTime: Math.floor(new Date(order.created_at).getTime() / 1000),
      sourceUrl: `${BASE_URL}/checkout/success`,
      identity: identityFor(order),
      custom: {
        /* The order's own currency column, not a hardcoded "MYR" — the shop
           ships overseas and the column exists precisely so this is not an
           assumption. */
        currency: (order.currency ?? "MYR").toUpperCase(),
        /* total_sen includes shipping and tax, which is what the customer paid.
           Stated here because changing it later produces a step change in
           reported ROAS that looks like a campaign event rather than a code
           change. */
        value: toMajorUnit(order.total_sen),
        order_id: order.reference,
        ...contentsFrom(items),
      },
    });

    await sendDurable("Purchase", event);
  } catch (e) {
    /* An ads pixel must never be able to fail a settlement. The money is in. */
    console.error("[capi] Purchase failed to build:", e instanceof Error ? e.message : e);
  }
}

/*
  AddPaymentInfo — the shopper chose how to pay.

  Fired from startPayment, where the order exists but no money has moved. The
  event id is derived from the reference rather than random so a shopper who
  goes back and picks a different bank does not report two.
*/
export async function sendAddPaymentInfo(orderId: string): Promise<void> {
  if (!capiConfigured()) return;

  try {
    const loaded = await loadOrder(orderId);
    if (!loaded) return;
    const { order, items } = loaded;

    const event = buildEvent({
      event: "AddPaymentInfo",
      eventId: `${order.reference}-api`,
      sourceUrl: `${BASE_URL}/checkout/pay`,
      identity: identityFor(order),
      custom: {
        currency: (order.currency ?? "MYR").toUpperCase(),
        value: toMajorUnit(order.total_sen),
        ...contentsFrom(items),
      },
    });

    await sendDurable("AddPaymentInfo", event);
  } catch (e) {
    console.error("[capi] AddPaymentInfo failed to build:", e instanceof Error ? e.message : e);
  }
}
