import { NextResponse } from "next/server";
import { providerByName } from "@/lib/payments";
import { settlePaymentWebhook } from "@/lib/payments/settle";

/*
  LeanX payment webhook.

  The URL is unchanged — it is registered in the LeanX dashboard and on every
  bill we have ever created, so it stays exactly where it was. Atome has its own
  route at /api/payments/atome/webhook.

  All of the settlement logic lives in settlePaymentWebhook, shared with Atome.
  This file decides one thing: which adapter verifies the envelope. Pinned to
  LeanX by NAME rather than "the configured provider" — now that two gateways
  exist, resolving that dynamically would let an Atome callback be verified with
  LeanX's secret, or vice versa.
*/
export async function POST(request: Request) {
  const provider = providerByName("leanx");
  if (!provider) {
    return NextResponse.json({ error: "LeanX is not configured" }, { status: 503 });
  }
  return settlePaymentWebhook(provider, request);
}
