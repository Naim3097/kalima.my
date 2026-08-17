import "server-only";

import { NextResponse } from "next/server";
import type { PaymentProvider } from "./types";
import {
  attributeReferral,
  markOrderPaid,
  refundOrderFromWebhook,
  resolveWebhookOrder,
} from "@/lib/commerce";
import { sendNewOrderNotification, sendPaymentConfirmedEmail } from "@/lib/email";

/*
  The ONLY place an order becomes paid (guide §6; PROJECT_PLAN §4.2).

  WHY THIS IS A FUNCTION AND NOT A ROUTE. It used to be the body of
  /api/payments/webhook, which was fine while LeanX was the only gateway. Adding
  Atome meant a second endpoint, and copying this logic into it would have been
  the fourth time this project split one money path across two call sites — the
  mistake the marketplace_sync migration and refund_order both carry warnings
  about, and the one that silently destroyed loyalty points when the gateway
  refund path bypassed refund_order. So the routes are now two lines each and
  every rule below is stated once.

  Rules, in order:

    1. verify the envelope (adapter's job) → 401 on failure (fail closed)
    2. a refund event                      → return goods to stock
    3. non-paid event (pending/unknown/…)  → 200, do nothing
    4. unknown order                       → 200, so the gateway stops retrying
    5. amount must match our order         → 200 + held for review
    6. markOrderPaid (idempotent)          → paid transition; side effects once

  markOrderPaid is idempotent, so redelivered webhooks never double-credit or
  double-email.

  NEVER 500 AT A GATEWAY. Every failure below acknowledges with 200 once the
  signature has passed, because a non-2xx makes the gateway retry a call that
  cannot succeed — a permanent storm with the customer already charged. The
  cases that need a human are logged for one, not retried at.
*/
export async function settlePaymentWebhook(
  provider: PaymentProvider,
  request: Request,
): Promise<Response> {
  let result;
  try {
    result = await provider.verifyWebhook(request);
  } catch {
    // Bad signature or malformed payload — do not leak details, do not process.
    return NextResponse.json({ error: "Invalid webhook" }, { status: 401 });
  }

  /*
    A refund raised in the gateway's own dashboard arrives here as a `refunded`
    event. It must be acted on, not just acknowledged: the goods have to go back
    to stock. refund_order is idempotent, so retries are harmless.

    This is how an Atome refund done in the merchant portal reaches us too —
    which is why the admin panel can stay recording-only without the two drifting
    apart.
  */
  if (result.status === "refunded") {
    const target = await resolveWebhookOrder(result.providerRef, result.orderReference);
    if (!target) return NextResponse.json({ received: true, note: "order not found" });
    try {
      const outcome = await refundOrderFromWebhook({
        orderId: target.id,
        amountSen: result.amountSen ?? target.total_sen,
        reason: "gateway refund",
      });
      return NextResponse.json({ received: true, status: outcome.status });
    } catch {
      return NextResponse.json({ received: true, note: "refund could not be applied" });
    }
  }

  if (!result.paid) {
    /*
      Valid but not a paid event — acknowledge so retries stop.

      Atome reaches here with status "unknown" when its API could not confirm the
      payment. That is deliberately indistinguishable from "not yet paid" at this
      point: both mean "do nothing", and treating an unreachable gateway as a
      failure is how a paid order gets cancelled.
    */
    return NextResponse.json({ received: true, status: result.status });
  }

  const order = await resolveWebhookOrder(result.providerRef, result.orderReference);
  if (!order) {
    return NextResponse.json({ received: true, note: "order not found" });
  }

  // The confirmed amount must match what we charged (never trust a payload's).
  if (typeof result.amountSen === "number" && result.amountSen !== order.total_sen) {
    /*
      Do NOT fulfil — but acknowledge with 200. The payload will never change, so
      a non-2xx just makes the gateway retry the same mismatch forever. The
      mismatch means the customer was charged an amount that is not their order
      total (LeanX's §0.5 "Fixed Amount" collection setting produces exactly
      this), so it needs a human, not a retry.
    */
    console.error(
      `[payments] AMOUNT MISMATCH on ${order.reference} via ${provider.name}: charged ${result.amountSen}, order is ${order.total_sen}. Not fulfilled — needs manual review.`,
    );
    return NextResponse.json({ received: true, note: "amount mismatch — held for review" });
  }

  /*
    mark_order_paid raises rather than returns on two reachable, NON-transient
    conditions: the order was cancelled between placement and this callback, or
    the oversell guard fires. An uncaught throw becomes a 500, and a 500 tells the
    gateway to retry a call that can never succeed. Catch it, log it, and 200 so
    the retries stop; the money is real and the order needs a person.
  */
  let outcome: Awaited<ReturnType<typeof markOrderPaid>>;
  try {
    outcome = await markOrderPaid({
      orderId: order.id,
      provider: provider.name,
      // null, not "": the payments unique index is (provider, provider_ref)
      // WHERE provider_ref IS NOT NULL, so "" would collide across orders.
      providerRef: result.providerRef || null,
      amountSen: result.amountSen ?? order.total_sen,
      raw: result.raw,
    });
  } catch (e) {
    console.error(
      `[payments] mark_order_paid FAILED for ${order.reference} via ${provider.name} — customer charged, order NOT settled:`,
      (e as Error).message,
    );
    return NextResponse.json({ received: true, note: "settlement held for review" });
  }

  // Side effects exactly once — only on the transition to paid, not on retries.
  if (outcome.status === "paid") {
    await sendPaymentConfirmedEmail(order.reference, order.email).catch(() => {});
    // The shop needs telling too, or a sale waits until someone opens the admin.
    await sendNewOrderNotification(order.reference, order.email).catch(() => {});
    // Affiliate commission accrues on a settled sale, not on a placed order.
    await attributeReferral(order.id);
  }

  return NextResponse.json({ received: true });
}
