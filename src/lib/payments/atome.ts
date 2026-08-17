import "server-only";

import crypto from "node:crypto";
import type {
  PaymentProvider,
  PaymentService,
  PaymentStatus,
  CheckoutRequest,
  CheckoutSession,
  WebhookResult,
} from "./types";

/*
  Atome provider — buy-now-pay-later, three interest-free instalments.

  Written against Atome Payment API v2 (the ONLINE integration):
  https://doc.apaylater.com/v2/  ·  spec: https://doc.apaylater.com/v2/swagger.yaml

  Config (env):
    ATOME_USERNAME         issued by the Atome account manager (Basic auth user)
    ATOME_PASSWORD         issued by the Atome account manager (Basic auth pass)
    ATOME_COUNTRY_CODE     MY
    ATOME_CALLBACK_SECRET  shared secret for the X-Signature HMAC (see below)
    ATOME_ENV              "production" selects api.apaylater.com; anything else
                           (or unset) stays on the api.apaylater.net sandbox

  THE ONE THING TO UNDERSTAND ABOUT THIS ADAPTER. Atome's callback carries a
  single field — `referenceId`. No status, no amount. So unlike LeanX, the
  payload cannot tell us whether the shopper paid; we always turn round and ask
  Atome over authenticated HTTPS (`GET /payments/{referenceId}`).

  That inverts where the trust sits, and for the better: a forged callback cannot
  fake a payment, because the body it controls is never the thing we believe. The
  X-Signature HMAC is defence in depth on top of that, not the load-bearing
  check. Atome's own spec says the signature details must be confirmed with your
  account manager, which is precisely why the design does not rest on it.
*/

const PROD_BASE = "https://api.apaylater.com/v2";
const TEST_BASE = "https://api.apaylater.net/v2";

const BASE = process.env.ATOME_ENV === "production" ? PROD_BASE : TEST_BASE;
const USERNAME = process.env.ATOME_USERNAME || "";
const PASSWORD = process.env.ATOME_PASSWORD || "";
const COUNTRY = process.env.ATOME_COUNTRY_CODE || "MY";
const CALLBACK_SECRET = process.env.ATOME_CALLBACK_SECRET || "";

/*
  Atome's documented MYR floor is RM10.00. Exported because the checkout page
  needs it to decide whether to offer Atome at all — a shopper who picks it and
  is then bounced by AMOUNT_NOT_VALID has been failed by us, not by Atome.

  There is no documented MYR ceiling; limits above this are set per merchant, so
  createCheckout surfaces Atome's rejection message rather than guessing one.
*/
export const ATOME_MIN_SEN = 1000;

/** Both credentials present → Atome is usable. */
export function atomeConfigured(): boolean {
  return Boolean(USERNAME && PASSWORD);
}

/** Which env vars are missing, for the admin/health surface. Names only. */
export function atomeMissingEnv(): string[] {
  return (
    [
      ["ATOME_USERNAME", USERNAME],
      ["ATOME_PASSWORD", PASSWORD],
    ] as const
  )
    .filter(([, v]) => !v)
    .map(([k]) => k);
}

function headers(): HeadersInit {
  const basic = Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64");
  return { "Content-Type": "application/json", Authorization: `Basic ${basic}` };
}

/*
  E.164, which is what customerInfo.mobileNumber requires — `+60123456789`.

  placeOrder has already validated the Malaysian form (`01` + 8–9 digits), so
  this only has to reshape it. Converting at the adapter boundary rather than in
  the checkout keeps one canonical stored format and lets each gateway ask for
  its own dialect, the same split lib/shipping/config.ts makes for timestamps.
*/
function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("60")) return `+${digits}`;
  if (digits.startsWith("0")) return `+60${digits.slice(1)}`;
  return `+${digits}`;
}

/*
  Atome's status vocabulary maps exactly onto ours — no invented states, and no
  status is silently dropped into a default. An unrecognised value returns
  undefined so callers can treat it as "unknown" rather than guessing.
*/
const STATUS_MAP: Record<string, PaymentStatus["status"]> = {
  PROCESSING: "processing",
  PAID: "completed",
  FAILED: "failed",
  REFUNDED: "refunded",
  CANCELLED: "cancelled",
};

type AtomePayment = {
  referenceId?: string;
  merchantReferenceId?: string;
  status?: string;
  amount?: number;
  currency?: string;
  redirectUrl?: string;
};

/*
  Fetches one payment. Returns null on ANY failure — a network blip, a 404 for a
  reference Atome has not committed yet, a malformed body.

  Null means "no verdict", never "not paid". Callers map it to "unknown", for the
  same reason the note on PaymentStatus gives: a flaky lookup must never be able
  to cancel an order that was in fact paid.
*/
async function getPayment(referenceId: string): Promise<AtomePayment | null> {
  if (!referenceId) return null;
  try {
    const res = await fetch(`${BASE}/payments/${encodeURIComponent(referenceId)}`, {
      method: "GET",
      headers: headers(),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as AtomePayment;
  } catch {
    return null;
  }
}

/*
  HMAC-SHA256 over the EXACT raw body, timing-safe, fail-closed — the same shape
  as verifySignature in leanx.ts.

  Atome sends hex; a base64 digest is accepted too because the spec does not
  pin the encoding and the account manager confirms it per merchant. Comparing
  both is not a weakness: each comparison is still against a digest only the
  holder of the secret could produce.
*/
function verifySignature(rawBody: string, signature: string): boolean {
  if (!CALLBACK_SECRET || !signature) return false;
  /* Two separate Hmac objects: one is consumed by digest(), so a single instance
     cannot produce both encodings. */
  const digest = (enc: "hex" | "base64") =>
    crypto.createHmac("sha256", CALLBACK_SECRET).update(rawBody).digest(enc);
  return [digest("hex"), digest("base64")].some((expected) => {
    if (signature.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  });
}

export const atome: PaymentProvider = {
  name: "atome",

  /*
    ONE SYNTHETIC OPTION, NOT AN API CALL.

    This is the single place the adapter bends the PaymentProvider interface.
    listPaymentServices exists because LeanX needs the shopper to choose a bank
    before a bill can be created; Atome has no equivalent list and no endpoint to
    ask. Rather than add a second method to the interface for one provider, Atome
    reports itself as one option so the checkout can render every way to pay from
    a single merged list.

    Returned under `ewallet: []` / a bnpl kind: the caller groups by `kind`, so
    the shape of this return value is not what decides where it appears.
  */
  async listPaymentServices(): Promise<{ fpx: PaymentService[]; ewallet: PaymentService[] }> {
    return {
      fpx: [],
      ewallet: [
        {
          id: "atome",
          name: "Atome — 3 interest-free payments",
          kind: "bnpl",
          provider: "atome",
        },
      ],
    };
  },

  /*
    Creates the payment and hands back Atome's own redirectUrl.

    IDEMPOTENT ON referenceId, by Atome's contract — so the caller must pass a
    reference that is unique per ATTEMPT, not per order. An unpaid payment is
    auto-cancelled after 12 hours, and reusing that reference would return the
    cancelled record instead of a fresh payable one. See buildAtomeReference in
    lib/payments/index.ts for how the suffix is chosen.

    merchantReferenceId always carries the plain order reference, which is what
    appears in Atome's settlement report and merchant portal — so a finance
    question about "KLM-10287" is answerable even when the payment reference
    carries a retry suffix.
  */
  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    if (req.amountSen < ATOME_MIN_SEN) {
      throw new Error(
        `Atome requires at least RM${(ATOME_MIN_SEN / 100).toFixed(2)} — this order is RM${(
          req.amountSen / 100
        ).toFixed(2)}.`,
      );
    }

    /*
      Refuse before calling out rather than letting Atome refuse for us. Their
      message ("Your request is missing customer shipping address") is accurate
      but arrives as a failed payment attempt; this arrives as a bug report with
      the order reference attached.
    */
    const addr = req.shippingAddress;
    if (!addr) throw new Error("Atome requires a shipping address on the order");

    /*
      Atome models an address as free-form `lines` plus a postcode and country —
      there are no separate city or state fields, so both go into `lines`. Blank
      parts are dropped: an empty string in the array is worse than a shorter
      address, because it reads as a missing line rather than an absent one.
    */
    const atomeAddress = {
      countryCode: (addr.country || COUNTRY || "MY").toUpperCase(),
      lines: [addr.line1, addr.line2, addr.city, addr.state]
        .map((l) => (l ?? "").trim())
        .filter(Boolean),
      postCode: addr.postcode.trim(),
    };

    const res = await fetch(`${BASE}/payments`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        // Per-attempt reference; also what the callback will quote back.
        referenceId: req.paymentServiceId,
        currency: "MYR",
        // Already the smallest unit on both sides — no conversion, no rounding.
        amount: req.amountSen,
        callbackUrl: req.callbackUrl,
        paymentResultUrl: req.returnUrl,
        // Falls back to returnUrl so an abandoned payment still lands somewhere.
        paymentCancelUrl: req.cancelUrl || req.returnUrl,
        merchantReferenceId: req.reference,
        customerInfo: {
          mobileNumber: toE164(req.phone),
          fullName: req.fullName || "Customer",
          email: req.email.trim(),
        },
        shippingAddress: atomeAddress,
        /*
          Billing is sent as the same address because checkout only ever
          collects one. Sent proactively rather than waiting to be asked: the
          schema is identical to shipping, so it cannot introduce a new
          rejection, and a merchant that also requires billing would otherwise
          fail the same way shipping just did.
        */
        billingAddress: atomeAddress,
      }),
      cache: "no-store",
    });

    const json = (await res.json().catch(() => ({}))) as AtomePayment & {
      code?: string;
      message?: string;
    };

    if (!res.ok || !json.redirectUrl) {
      /*
        Surface Atome's own words. Its documented failures are the ones an
        operator can actually act on — AMOUNT_NOT_VALID (outside this merchant's
        limits), CURRENCY_NOT_SUPPORTED, INVALID_CALLBACK_URL — and each reads
        as a configuration problem, not a bug, once you can see it.
      */
      const reason = json.message || json.code || `HTTP ${res.status}`;
      throw new Error(`Atome create-payment failed: ${reason}`);
    }

    return { redirectUrl: json.redirectUrl, providerRef: String(json.referenceId ?? req.paymentServiceId) };
  },

  /*
    The callback carries ONLY referenceId, so this verifies the envelope and then
    asks Atome what actually happened. See the note at the top of the file for
    why that ordering is the point rather than an inconvenience.

    Throws on a bad signature so the route answers 401, matching leanx.ts.
    A callback we cannot resolve to a real payment returns a non-paid result
    rather than throwing: Atome records non-200 responses and will retry, and
    there is nothing to retry when the reference is simply unknown to us.
  */
  async verifyWebhook(request: Request): Promise<WebhookResult> {
    // Raw body FIRST — the HMAC is over the exact bytes, before any parsing.
    const raw = await request.text();

    /*
      Only enforced when a secret is configured. With none set the callback is
      still not trusted for anything: the status and amount below come from the
      authenticated GET, so the worst a forged POST achieves is making us ask
      Atome about a reference we already own.
    */
    /*
      WATCH THIS WHEN YOU SET THE SECRET. The signature check runs before the
      ping tolerance below, so if Atome's POST /auth reachability probe is sent
      UNSIGNED, enabling the secret will make that probe 401 and /auth will go
      back to reporting CALLBACK_FAILED — with real callbacks still working
      fine. Ask the account manager whether the connectivity probe is signed;
      if it is not, the check has to move after the referenceId test.
    */
    if (CALLBACK_SECRET) {
      const sig = request.headers.get("x-signature") ?? "";
      if (!verifySignature(raw, sig)) throw new Error("Atome webhook signature invalid");
    }

    /*
      A BODY WITH NO referenceId IS A PING, NOT A FAULT.

      Atome's POST /auth connectivity check posts to this endpoint and treats
      any non-20x as CALLBACK_FAILED — which is exactly what happened when this
      threw: the credentials authenticated perfectly and Atome still reported
      the integration unusable, because the reachability probe carries no
      referenceId and got a 401 back.

      Same reasoning the channel webhook already applies to heartbeats and
      status pings. Acknowledging costs nothing: there is no reference, so no
      order is looked up and nothing can be settled. 401 stays reserved for a
      failed signature, which is a genuine authentication failure.
    */
    let referenceId = "";
    try {
      referenceId = String((JSON.parse(raw) as { referenceId?: string }).referenceId ?? "");
    } catch {
      /* Not JSON — an empty probe body reads the same way as one without an id. */
    }

    if (!referenceId) return { paid: false, status: "unknown" };

    const payment = await getPayment(referenceId);
    if (!payment) {
      /*
        We could not confirm. Deliberately NOT an error status — "failed" here
        would let an unreachable Atome cancel a paid order. The route treats a
        non-paid, non-refunded result as a no-op and 200s.
      */
      return { paid: false, status: "unknown", providerRef: referenceId };
    }

    const status = STATUS_MAP[String(payment.status ?? "").toUpperCase()] ?? "unknown";

    return {
      paid: status === "completed",
      status,
      providerRef: referenceId,
      // Atome's own field for our order reference — the secondary lookup key.
      orderReference: payment.merchantReferenceId || undefined,
      amountSen: typeof payment.amount === "number" ? payment.amount : undefined,
      raw: payment,
    };
  },

  /*
    Needed for the same reason as LeanX's: an abandoned checkout is never
    announced, so without a pull an order sits `pending` while the buyer has been
    told it was received. Atome also auto-cancels after 12 hours, which this is
    how we find out about.
  */
  async checkStatus(referenceId: string): Promise<PaymentStatus> {
    const payment = await getPayment(referenceId);
    if (!payment) return { status: "unknown" };

    const mapped = STATUS_MAP[String(payment.status ?? "").toUpperCase()];
    if (!mapped) return { status: "unknown", raw: payment };

    return {
      status: mapped,
      amountSen: typeof payment.amount === "number" ? payment.amount : undefined,
      raw: payment,
    };
  },
};

/*
  Atome's own connectivity check (POST /auth). Confirms the credentials work AND
  that Atome's servers can reach our callback URL — which is the failure that is
  hardest to diagnose later, because everything looks fine until a real payment
  never settles.

  Used by /api/payments/health. Returns a plain verdict rather than throwing, so
  a health endpoint can report it without a try/catch at the call site.
*/
export async function atomeSelfCheck(
  callbackUrl?: string,
): Promise<{ ok: boolean; detail: string }> {
  if (!atomeConfigured()) {
    return { ok: false, detail: `missing env: ${atomeMissingEnv().join(", ")}` };
  }
  try {
    const res = await fetch(`${BASE}/auth`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ countryCode: COUNTRY, ...(callbackUrl ? { callbackUrl } : {}) }),
      cache: "no-store",
    });
    if (res.ok) return { ok: true, detail: `${COUNTRY} · ${BASE}` };
    const json = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    return { ok: false, detail: json.code || json.message || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "unreachable" };
  }
}
