import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getPaymentProvider } from "@/lib/payments";
import { getCurrentUser, isStaff } from "@/lib/auth";

/*
  Payment configuration, readable at runtime.

  The callback URL is the one setting that can break payments invisibly: point
  it at a host the gateway cannot reach — a deployment-specific Vercel URL
  behind Deployment Protection, say — and its POST meets the SSO wall. No
  rejection, no request, nothing in the logs, and every paid order sits pending
  while customers are charged. Once the credentials are marked sensitive there
  is no other way to read back what was actually computed, so it is echoed here.

  Deliberately leaks nothing: booleans for whether each credential is present,
  never a prefix or a length. `configured` follows the same rule the checkout
  uses, so this answers "will the shopper be offered payment" honestly.
*/
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  /*
    ?probe=services performs the first call that actually exercises the
    credentials, and is the only way to see the bank list before an order
    exists — the picker needs a placed order, which needs stock.

    STAFF ONLY. Each call makes several authenticated requests to LeanX using
    the merchant credentials, so left open it let an anonymous caller drive the
    account toward LeanX's rate limits. The plain health check below stays
    public — it discloses only booleans — but the probe that spends credentials
    is gated. Read the names, not just the count: the guide's §0.1 failure shows
    up as entries the parser dropped for having no usable label.
  */
  if (new URL(request.url).searchParams.get("probe") === "services") {
    const me = await getCurrentUser();
    if (!isStaff(me?.role)) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
    const provider = getPaymentProvider();
    if (!provider) return NextResponse.json({ error: "No provider configured" }, { status: 503 });
    try {
      const { fpx, ewallet } = await provider.listPaymentServices();
      return NextResponse.json({
        fpx: { count: fpx.length, services: fpx },
        ewallet: { count: ewallet.length, services: ewallet },
        note:
          fpx.length + ewallet.length === 0
            ? "Empty. Usually a Payment Channels setting on the collection, not a code fault."
            : undefined,
      });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  const origin = siteUrl || (host ? `${proto}://${host}` : null);

  return NextResponse.json({
    configured: Boolean(getPaymentProvider()),
    credentials: {
      LEANX_AUTH_TOKEN: Boolean(process.env.LEANX_AUTH_TOKEN),
      LEANX_COLLECTION_UUID: Boolean(process.env.LEANX_COLLECTION_UUID),
      // Absent means every callback 401s: bills create, nothing is ever paid.
      LEANX_WEBHOOK_SECRET: Boolean(process.env.LEANX_WEBHOOK_SECRET),
    },
    apiHost: process.env.LEANX_API_HOST || "https://api.leanx.io",
    // Must be .io — .dev is legacy and unstable.
    apiHostLooksRight: (process.env.LEANX_API_HOST || "https://api.leanx.io").includes("api.leanx.io"),
    origin,
    originSource: siteUrl ? "NEXT_PUBLIC_SITE_URL" : "request headers",
    callbackUrl: origin ? `${origin}/api/payments/webhook` : null,
    returnUrl: origin ? `${origin}/checkout/success` : null,
    /*
      Pinning the origin is what makes the callback URL independent of whichever
      host the shopper happened to arrive on.
    */
    warnings: [
      ...(siteUrl ? [] : ["NEXT_PUBLIC_SITE_URL is unset — the callback URL follows the request host."]),
      ...(process.env.LEANX_AUTH_TOKEN && !process.env.LEANX_WEBHOOK_SECRET
        ? ["Auth token set without a webhook secret — bills will create but no order can ever be paid."]
        : []),
    ],
  });
}
