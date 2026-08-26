import "server-only";

import crypto from "node:crypto";
import type {
  CheckoutRequest,
  CheckoutSession,
  PaymentProvider,
  PaymentService,
  PaymentStatus,
  WebhookResult,
} from "./types";

/*
  Stripe — Visa / Mastercard (and the wallets Stripe Checkout adds for free).

  A THIRD provider beside LeanX (FPX, e-wallets) and Atome (instalments),
  because LeanX carries no card acquiring. Uses Stripe CHECKOUT — Stripe's own
  hosted page — so no card number ever reaches this codebase and the PCI
  burden stays SAQ-A, the same posture the other two redirects already have.

  Written against the REST API directly rather than the `stripe` npm package:
  the four calls needed here are one-liners, the request signing is documented
  HMAC, and every other adapter in this directory is plain fetch. Pinned to an
  API version so Stripe's payload shapes cannot change under a running shop.

  Security contract, unchanged from types.ts: an order is marked paid ONLY from
  the webhook, after the signature verifies AND the amount matches the order.
  The success redirect proves nothing and is treated that way.

  Reference plumbing:
    providerRef    = the Checkout Session id (cs_…) — stored on the payment row
    orderReference = client_reference_id       — our KLM-… reference
  The session carries our reference so a settlement can be matched either way.
*/

const API = "https://api.stripe.com/v1";
const API_VERSION = "2025-06-30.basil";

const SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

/*
  How long a signed webhook is accepted for, matching Stripe's own SDK default.
  A replayed event outside this window is refused even with a valid signature.
*/
const SIGNATURE_TOLERANCE_S = 300;

/** Credentials present — Stripe options appear on /checkout/pay. */
export function stripeConfigured(): boolean {
  return Boolean(SECRET_KEY && WEBHOOK_SECRET);
}

export function stripeMissingEnv(): string[] {
  const missing: string[] = [];
  if (!SECRET_KEY) missing.push("STRIPE_SECRET_KEY");
  if (!WEBHOOK_SECRET) missing.push("STRIPE_WEBHOOK_SECRET");
  return missing;
}

/** Live key or test key — surfaced by the health endpoint so nobody has to guess. */
export function stripeMode(): "live" | "test" | "unset" {
  if (!SECRET_KEY) return "unset";
  return SECRET_KEY.startsWith("sk_live_") ? "live" : "test";
}

type StripeSession = {
  id: string;
  url?: string | null;
  status?: "open" | "complete" | "expired" | null;
  payment_status?: "paid" | "unpaid" | "no_payment_required" | null;
  amount_total?: number | null;
  currency?: string | null;
  client_reference_id?: string | null;
  payment_intent?: string | null;
};

/*
  Stripe takes application/x-www-form-urlencoded with bracketed keys for
  nested objects and arrays (line_items[0][price_data][currency]=myr). This
  flattens a plain object into that shape so the call sites can read like the
  documented JSON examples.
*/
function encodeForm(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === "object") out.push(...encodeForm(item as Record<string, unknown>, `${key}[${i}]`));
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === "object") {
      out.push(...encodeForm(v as Record<string, unknown>, key));
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out;
}

async function stripeRequest<T>(
  path: string,
  init?: { method?: "GET" | "POST"; body?: Record<string, unknown>; idempotencyKey?: string },
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${SECRET_KEY}`,
      "Stripe-Version": API_VERSION,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(init?.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
    },
    body: init?.body ? encodeForm(init.body).join("&") : undefined,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: string } };
  if (!res.ok) {
    throw new Error(`Stripe ${path} failed: ${json.error?.message ?? json.error?.code ?? `HTTP ${res.status}`}`);
  }
  return json;
}

/*
  Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>…]. The signed payload is
  `${t}.${rawBody}`; any one v1 matching is enough (Stripe sends several during
  a secret rotation). Constant-time compare, length-checked first because
  timingSafeEqual throws on mismatched lengths.
*/
function verifySignature(rawBody: string, header: string): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.trim().split("=") as [string, string]).filter((p) => p.length === 2),
  ) as Record<string, string>;
  const t = parts.t;
  const sigs = header.split(",").map((p) => p.trim()).filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sigs.length) return false;

  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_S) return false;

  const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  return sigs.some((s) => {
    const b = Buffer.from(s);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

function mapSession(s: StripeSession): PaymentStatus["status"] {
  if (s.payment_status === "paid") return "completed";
  if (s.status === "expired") return "cancelled";
  if (s.status === "open") return "processing";
  if (s.status === "complete") return "processing"; // complete but not yet paid — async methods
  return "unknown";
}

export const stripe: PaymentProvider = {
  name: "stripe",

  /*
    A Checkout Session stays payable for 24 hours by default; ours are created
    with a one-hour expiry (below) so an abandoned card page cannot be paid a
    day later against an order the shop has already closed. Rounded up, as
    the note on payableWindowMinutes asks.
  */
  payableWindowMinutes: 75,

  /*
    One synthetic option, like Atome: Stripe has no bank list to fetch, the
    card form lives on its hosted page. Reported under a `card` kind so the
    picker gives it its own heading rather than filing it with e-wallets.
  */
  async listPaymentServices(): Promise<{ fpx: PaymentService[]; ewallet: PaymentService[] }> {
    return {
      fpx: [],
      ewallet: [
        {
          id: "stripe-card",
          name: "Credit / debit card — Visa, Mastercard",
          kind: "card",
          provider: "stripe",
        },
      ],
    };
  },

  /*
    Creates a Checkout Session for the ORDER'S total — one line, the order
    reference as its name — rather than itemising. Stripe's line items are for
    the receipt Stripe shows, and a single figure cannot drift from what the
    order charges the way a re-itemised list with a discount could. The
    breakdown the shopper already saw is on our own success page.

    Idempotent per payment attempt via the Idempotency-Key, so a double click
    does not mint two sessions for one order.
  */
  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    const session = await stripeRequest<StripeSession>("/checkout/sessions", {
      method: "POST",
      idempotencyKey: `kalima-${req.paymentServiceId}`,
      body: {
        mode: "payment",
        client_reference_id: req.reference,
        customer_email: req.email.trim() || undefined,
        currency: "myr",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "myr",
              unit_amount: req.amountSen,
              product_data: {
                name: `Kalima order ${req.reference}`,
                description: (req.lines ?? [])
                  .map((l) => `${l.name}${l.variation ? ` (${l.variation})` : ""} × ${l.qty}`)
                  .join(", ")
                  .slice(0, 500) || undefined,
              },
            },
          },
        ],
        payment_method_types: ["card"],
        /* Stripe appends the session id itself; our success page never trusts
           it — settlement is the webhook's job. */
        success_url: req.returnUrl,
        cancel_url: req.cancelUrl || req.returnUrl,
        expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
        metadata: { order_reference: req.reference },
        payment_intent_data: {
          description: `Kalima order ${req.reference}`,
          metadata: { order_reference: req.reference },
        },
      },
    });

    if (!session.url) throw new Error("Stripe returned a session with no hosted URL");
    return { redirectUrl: session.url, providerRef: session.id };
  },

  /*
    Verifies the Stripe-Signature over the raw bytes, then reads the event.

    checkout.session.completed / async_payment_succeeded → paid, with the
    session's amount_total for the settle path's amount check.
    charge.refunded → refunded, resolved through the PaymentIntent back to the
    session so the order can be found by providerRef.
    Anything else is acknowledged and ignored — Stripe sends many event types
    and only these three change an order.

    Throws on a bad signature so the route answers 401, matching the others.
  */
  async verifyWebhook(request: Request): Promise<WebhookResult> {
    const raw = await request.text();
    const sig = request.headers.get("stripe-signature") ?? "";
    if (!verifySignature(raw, sig)) throw new Error("Stripe webhook signature invalid");

    const event = JSON.parse(raw) as { type: string; data: { object: Record<string, unknown> } };
    const obj = event.data?.object ?? {};

    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const s = obj as StripeSession;
      const paid = s.payment_status === "paid";
      return {
        paid,
        status: paid ? "completed" : "processing",
        providerRef: s.id,
        orderReference: s.client_reference_id ?? undefined,
        amountSen: typeof s.amount_total === "number" ? s.amount_total : undefined,
        raw: s,
      };
    }

    if (event.type === "checkout.session.async_payment_failed" || event.type === "checkout.session.expired") {
      const s = obj as StripeSession;
      return { paid: false, status: event.type.endsWith("expired") ? "cancelled" : "failed", providerRef: s.id, orderReference: s.client_reference_id ?? undefined, raw: s };
    }

    if (event.type === "charge.refunded") {
      const charge = obj as { payment_intent?: string | null; amount_refunded?: number; metadata?: Record<string, string> };
      const orderReference = charge.metadata?.order_reference;
      /* Map the PaymentIntent back to its Checkout Session so providerRef
         matches the stored row; fall back to the order reference otherwise. */
      let providerRef: string | undefined;
      if (charge.payment_intent) {
        try {
          const list = await stripeRequest<{ data: StripeSession[] }>(
            `/checkout/sessions?payment_intent=${encodeURIComponent(charge.payment_intent)}&limit=1`,
          );
          providerRef = list.data?.[0]?.id;
        } catch {
          /* The order reference below still finds it. */
        }
      }
      return {
        paid: false,
        status: "refunded",
        providerRef,
        orderReference,
        amountSen: typeof charge.amount_refunded === "number" ? charge.amount_refunded : undefined,
        raw: charge,
      };
    }

    return { paid: false, status: "unknown", raw: event };
  },

  /*
    Pulls the session. Stripe DOES push expiries and failures, unlike the other
    two gateways, but the expiry sweep and "try again" path still ask directly,
    and a session that cannot be read is "unknown" — never "failed".
  */
  async checkStatus(sessionId: string): Promise<PaymentStatus> {
    try {
      const s = await stripeRequest<StripeSession>(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
      return {
        status: mapSession(s),
        amountSen: typeof s.amount_total === "number" ? s.amount_total : undefined,
        raw: s,
      };
    } catch {
      return { status: "unknown" };
    }
  },
};

/*
  Refunds a card payment through Stripe, in full or in part.

  The one thing this gateway can do that LeanX cannot: LeanX has no refund
  API, so the admin's Record Refund panel only records. For a Stripe order the
  money can actually move. Resolved from the stored session id to its
  PaymentIntent, which is what Stripe refunds against. Stripe then emits
  charge.refunded, which the webhook turns into the stock return — so the
  caller should NOT also call refund_order, or the goods come back twice.
*/
export async function stripeRefund(sessionId: string, amountSen?: number): Promise<{ refundId: string }> {
  const s = await stripeRequest<StripeSession>(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (!s.payment_intent) throw new Error("This Stripe session has no payment to refund.");
  const refund = await stripeRequest<{ id: string }>("/refunds", {
    method: "POST",
    idempotencyKey: `kalima-refund-${sessionId}-${amountSen ?? "full"}`,
    body: { payment_intent: s.payment_intent, ...(amountSen ? { amount: amountSen } : {}) },
  });
  return { refundId: refund.id };
}

/** Credentials check for /api/payments/health — reads the account, spends nothing. */
export async function stripeSelfCheck(): Promise<{ ok: boolean; detail: string }> {
  if (!stripeConfigured()) return { ok: false, detail: `missing ${stripeMissingEnv().join(", ")}` };
  try {
    const acct = await stripeRequest<{ id: string; charges_enabled?: boolean; default_currency?: string }>("/account");
    return {
      ok: Boolean(acct.charges_enabled),
      detail: `${acct.id} · ${stripeMode()} · charges ${acct.charges_enabled ? "enabled" : "NOT enabled"} · ${acct.default_currency ?? "?"}`,
    };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "unreachable" };
  }
}
