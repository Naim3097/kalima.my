import { NextResponse } from "next/server";
import { providerByName } from "@/lib/payments";
import { settlePaymentWebhook } from "@/lib/payments/settle";

/*
  Stripe webhook — register this URL in the Stripe dashboard (Developers →
  Webhooks) for the events checkout.session.completed,
  checkout.session.async_payment_succeeded, checkout.session.async_payment_failed,
  checkout.session.expired and charge.refunded, and put the endpoint's signing
  secret in STRIPE_WEBHOOK_SECRET. One endpoint per environment: staging and
  production have different secrets.

  Its own route for the same reason Atome has one: the settlement logic is
  shared (settlePaymentWebhook), only the front door differs. The adapter
  verifies Stripe-Signature over the raw body before anything is read.
*/
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const provider = providerByName("stripe");
  if (!provider) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 });
  }
  return settlePaymentWebhook(provider, request);
}
