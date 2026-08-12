import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getPaymentProvider } from "@/lib/payments";

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

export async function GET() {
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
