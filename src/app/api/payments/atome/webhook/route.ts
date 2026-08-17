import { NextResponse } from "next/server";
import { providerByName } from "@/lib/payments";
import { settlePaymentWebhook } from "@/lib/payments/settle";

/*
  Atome payment callback — the URL sent as `callbackUrl` on every payment we
  create, and the one POST /auth checks reachability for.

  A separate route from LeanX's rather than one /api/payments/[provider]/webhook:
  LeanX's endpoint is already registered in their dashboard and quoted on live
  bills, and moving it to make room for a parameter would be a migration with no
  upside. The settlement logic is shared regardless — see settlePaymentWebhook.

  Worth knowing when reading logs: Atome POSTs here on EVERY status change,
  including immediately after we create a payment (status PROCESSING). Those are
  ordinary traffic, not noise to be silenced — the shared handler acknowledges
  them and does nothing.

  Optional hardening: Atome's MY outbound addresses are 47.254.230.20 and
  47.254.238.153 (47.254.247.54 on test). A Vercel Firewall rule limiting this
  path to those would be defence in depth on top of the X-Signature HMAC and the
  authenticated status lookup the adapter already performs.
*/
export async function POST(request: Request) {
  const provider = providerByName("atome");
  if (!provider) {
    return NextResponse.json({ error: "Atome is not configured" }, { status: 503 });
  }
  return settlePaymentWebhook(provider, request);
}
