import { NextResponse } from "next/server";
import { getPaymentProvider } from "@/lib/payments";
import {
  attributeReferral,
  markOrderPaid,
  refundOrderFromWebhook,
  resolveWebhookOrder,
} from "@/lib/commerce";
import { sendNewOrderNotification, sendPaymentConfirmedEmail } from "@/lib/email";

/*
  Payment gateway webhook — the ONLY place an order becomes paid (guide §6;
  PROJECT_PLAN §4.2). Rules, in order:

    1. no provider configured        → 503 (fail closed)
    2. verify HMAC over the raw body → 401 on failure (fail closed)
    3. non-paid event (pending/…)    → 200, do nothing
    4. unknown order                 → 200, so LeanX stops retrying
    5. amount must match our order   → 409 on mismatch
    6. markOrderPaid (idempotent)    → paid transition; email once

  markOrderPaid is idempotent, so redelivered webhooks never double-credit or
  double-email.
*/
export async function POST(request: Request) {
  const provider = getPaymentProvider();
  if (!provider) {
    return NextResponse.json({ error: "No payment provider configured" }, { status: 503 });
  }

  let result;
  try {
    result = await provider.verifyWebhook(request);
  } catch {
    // Bad signature or malformed payload — do not leak details, do not process.
    return NextResponse.json({ error: "Invalid webhook" }, { status: 401 });
  }

  // A refund raised in the LeanX dashboard arrives here as a `refunded` event.
  // It must be acted on, not just acknowledged: the goods have to go back to
  // stock. refund_order is idempotent, so retries are harmless.
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
      // Never 500 at a gateway: that just triggers an endless retry storm.
      return NextResponse.json({ received: true, note: "refund could not be applied" });
    }
  }

  if (!result.paid) {
    // Valid but not a paid event — acknowledge so retries stop.
    return NextResponse.json({ received: true, status: result.status });
  }

  const order = await resolveWebhookOrder(result.providerRef, result.orderReference);
  if (!order) {
    // Unknown order — ack 200 so LeanX stops retrying, but do nothing.
    return NextResponse.json({ received: true, note: "order not found" });
  }

  // The webhook's amount must match what we charged (never trust its number).
  if (typeof result.amountSen === "number" && result.amountSen !== order.total_sen) {
    /*
      Do NOT fulfil — but acknowledge with 200. The payload will never change,
      so a non-2xx here just makes LeanX retry the same mismatch on its full
      schedule, forever. The mismatch means the customer was charged an amount
      that is not their order total (the guide's §0.5 "Fixed Amount" collection
      setting produces exactly this), so it needs a human, not a retry.
    */
    console.error(
      `[payments] AMOUNT MISMATCH on ${order.reference}: charged ${result.amountSen}, order is ${order.total_sen}. Not fulfilled — needs manual review.`,
    );
    return NextResponse.json({ received: true, note: "amount mismatch — held for review" });
  }

  /*
    mark_order_paid raises rather than returns on two reachable, NON-transient
    conditions: the order was cancelled between placement and this callback, or
    the oversell guard fires. An uncaught throw here becomes a 500, and a 500
    tells LeanX to retry a call that can never succeed — a permanent storm with
    the customer already charged. Catch it, log it, and 200 so the retries stop;
    the money is real and the order needs a person, not another attempt.
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
      `[payments] mark_order_paid FAILED for ${order.reference} — customer charged, order NOT settled:`,
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
