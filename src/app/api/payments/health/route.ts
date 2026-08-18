import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  ATOME_MIN_SEN,
  configuredProviders,
  getPaymentProvider,
  providerByName,
} from "@/lib/payments";
import { atomeConfigured, atomeSelfCheck } from "@/lib/payments/atome";
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

  STAFF ONLY, ALL OF IT. "Booleans, not values" was true and was not the whole
  question: the body also names which gateways are live, whether Atome is on
  sandbox or production, both callback URLs, and a warnings array that states
  the current breakage in plain English ("bills will create but no order can
  ever be paid"). That is a reconnaissance map of the payment integration's weak
  spot, and there is no reason an anonymous caller needs it. Anonymous callers
  get a bare liveness answer, which is all an uptime monitor ever wanted.
*/
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await getCurrentUser();
  const staff = isStaff(viewer?.role);
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
    if (!staff) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
    const provider = providerByName("leanx");
    if (!provider) return NextResponse.json({ error: "LeanX is not configured" }, { status: 503 });

    const h = await headers();
    const probeHost = h.get("x-forwarded-host") ?? h.get("host") ?? "";
    const probeOrigin =
      process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "") ||
      (probeHost ? `https://${probeHost}` : "");

    /*
      Atome's own POST /auth check runs alongside the bank list. It is the only
      way to confirm, before a real payment, both that the credentials work AND
      that Atome's servers can reach our callback — the failure that is hardest
      to diagnose afterwards, because everything looks fine until a paid order
      never settles.
    */
    const atomeCheck = atomeConfigured()
      ? await atomeSelfCheck(probeOrigin ? `${probeOrigin}/api/payments/atome/webhook` : undefined)
      : { ok: false, detail: "not configured" };

    try {
      const { fpx, ewallet } = await provider.listPaymentServices();
      return NextResponse.json({
        fpx: { count: fpx.length, services: fpx },
        ewallet: { count: ewallet.length, services: ewallet },
        atome: atomeCheck,
        note:
          fpx.length + ewallet.length === 0
            ? "Empty. Usually a Payment Channels setting on the collection, not a code fault."
            : undefined,
      });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message, atome: atomeCheck }, { status: 502 });
    }
  }

  /*
    Anonymous callers get liveness and nothing else. An uptime monitor needs a
    200 and a shape it can match; it does not need to know which credential is
    missing today.
  */
  if (!staff) {
    return NextResponse.json({ ok: true, configured: Boolean(getPaymentProvider()) });
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  const origin = siteUrl || (host ? `${proto}://${host}` : null);

  const atomeEnv = process.env.ATOME_ENV === "production" ? "production" : "test";

  return NextResponse.json({
    configured: Boolean(getPaymentProvider()),
    providers: configuredProviders().map((p) => p.name),
    credentials: {
      LEANX_AUTH_TOKEN: Boolean(process.env.LEANX_AUTH_TOKEN),
      LEANX_COLLECTION_UUID: Boolean(process.env.LEANX_COLLECTION_UUID),
      // Absent means every callback 401s: bills create, nothing is ever paid.
      LEANX_WEBHOOK_SECRET: Boolean(process.env.LEANX_WEBHOOK_SECRET),
      ATOME_USERNAME: Boolean(process.env.ATOME_USERNAME),
      ATOME_PASSWORD: Boolean(process.env.ATOME_PASSWORD),
      /*
        No callback-secret row, because Atome issues no such secret: the
        X-Signature key is Base64(ATOME_PASSWORD). The password line above is
        therefore also the answer to "are callbacks signature-checked?" — see
        callbackSigning below, which says so in words.
      */
    },
    atome: {
      env: atomeEnv,
      apiHost: atomeEnv === "production" ? "https://api.apaylater.com/v2" : "https://api.apaylater.net/v2",
      countryCode: process.env.ATOME_COUNTRY_CODE || "MY",
      minimumRM: ATOME_MIN_SEN / 100,
      callbackUrl: origin ? `${origin}/api/payments/atome/webhook` : null,
      callbackSigning: process.env.ATOME_PASSWORD
        ? "enforced — HMAC-SHA256, key is Base64(ATOME_PASSWORD)"
        : "unconfigured",
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
      ...(process.env.ATOME_USERNAME && atomeEnv !== "production"
        ? ["Atome is pointed at the sandbox (api.apaylater.net) — set ATOME_ENV=production to take real payments."]
        : []),
    ],
  });
}
