import { NextResponse } from "next/server";
import { getPaymentProvider } from "@/lib/payments";
import { markOrderPaid } from "@/lib/commerce";
import { sendPaymentConfirmedEmail } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/server";

/*
  Payment gateway webhook — the ONLY place an order becomes paid (§4.2: payment
  confirmed by webhook, never by the client redirect).

  Flow, once LeanX is wired:
    1. provider.verifyWebhook() checks the signature and extracts the outcome
    2. on a verified "paid" event, markOrderPaid() atomically records the
       payment, decrements stock (oversell-guarded) and flips the order

  markOrderPaid is idempotent, so gateway retries are safe. Until a provider is
  configured this returns 503 — there is deliberately no mock success path.
*/
export async function POST(request: Request) {
  const provider = getPaymentProvider();
  if (!provider) {
    return NextResponse.json(
      { error: "No payment provider configured" },
      { status: 503 },
    );
  }

  let result;
  try {
    result = await provider.verifyWebhook(request);
  } catch {
    // Signature failure or malformed payload — do not leak details.
    return NextResponse.json({ error: "Invalid webhook" }, { status: 400 });
  }

  if (!result.paid || !result.orderReference) {
    // A valid but non-paid event (pending/failed) — acknowledge, do nothing.
    return NextResponse.json({ received: true });
  }

  // Resolve the reference to an order id. The webhook has no session, so this
  // uses the admin client directly.
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }
  const { data: order } = await admin
    .from("orders")
    .select("id, total_sen, email")
    .eq("reference", result.orderReference)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Guard against an amount mismatch between the gateway and our order.
  if (typeof result.amountSen === "number" && result.amountSen !== order.total_sen) {
    return NextResponse.json({ error: "Amount mismatch" }, { status: 409 });
  }

  const outcome = await markOrderPaid({
    orderId: order.id,
    provider: provider.name,
    providerRef: result.providerRef ?? "",
    amountSen: result.amountSen ?? order.total_sen,
    raw: result.raw,
  });

  // Send the confirmation only on the transition to paid, not on retries.
  if (outcome.status === "paid") {
    await sendPaymentConfirmedEmail(result.orderReference, order.email).catch(() => {});
  }

  return NextResponse.json({ received: true });
}
