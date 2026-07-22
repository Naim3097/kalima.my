import "server-only";

import crypto from "node:crypto";
import type {
  PaymentProvider,
  PaymentService,
  CheckoutRequest,
  CheckoutSession,
  WebhookResult,
} from "./types";

/*
  LeanX provider — Malaysian FPX + e-wallet gateway (Silent Bill flow).
  Implemented against LEANX_SAAS_INTEGRATION_GUIDE.md. Every mandatory field and
  documented gotcha is handled here; see the inline notes.

  Config (env):
    LEANX_API_HOST         https://api.leanx.io   (must be .io, not .dev)
    LEANX_AUTH_TOKEN       the "Auth Token"        (auth-token header)
    LEANX_COLLECTION_UUID  the "Collection UUID"
    LEANX_WEBHOOK_SECRET   the "Hash Key"          (webhook HMAC)
*/

const HOST = process.env.LEANX_API_HOST || "https://api.leanx.io";
const AUTH_TOKEN = process.env.LEANX_AUTH_TOKEN || "";
const COLLECTION_UUID = process.env.LEANX_COLLECTION_UUID || "";
const WEBHOOK_SECRET = process.env.LEANX_WEBHOOK_SECRET || "";

/** All credentials present → LeanX is usable. */
export function leanxConfigured(): boolean {
  return Boolean(AUTH_TOKEN && COLLECTION_UUID);
}

const SUCCESS = 2000; // LeanX success sentinel on every response

/** Auth is a plain `auth-token` header — never `Authorization: Bearer`. */
function headers(): HeadersInit {
  return { "Content-Type": "application/json", "auth-token": AUTH_TOKEN };
}

/** MY MSISDN digits, no `+`. Falls back to a placeholder — never send empty. */
function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "60123456789";
  if (digits.startsWith("60")) return digits;
  if (digits.startsWith("0")) return "6" + digits; // 0123... → 60123...
  return digits;
}

/** Non-empty email or a placeholder — LeanX rejects an empty email. */
function safeEmail(email: string): string {
  const e = email.trim();
  return e || "noreply@kalima.my";
}

/*
  The service list comes back in several shapes depending on B2C/B2B/account
  type (guide §5). Parse all of them defensively.
*/
function parseServices(data: unknown, paymentType: string): { id: string; name: string }[] {
  const d = data as Record<string, unknown>;
  const inner = d?.data as unknown;

  // CASE A — flat array
  if (Array.isArray(inner)) return normaliseList(inner);
  // CASE B — object wrapper
  const wrapped = (inner as Record<string, unknown>)?.payment_services;
  if (Array.isArray(wrapped)) return normaliseList(wrapped);
  // CASE C — deep nested (B2B/enterprise)
  const list = ((inner as Record<string, unknown>)?.list as Record<string, unknown>)?.data;
  if (Array.isArray(list) && list.length) {
    const first = list[0] as Record<string, unknown>;
    const byType = first?.[paymentType];
    if (Array.isArray(byType)) return normaliseList(byType);
  }
  return [];
}

function normaliseList(arr: unknown[]): { id: string; name: string }[] {
  return arr
    .map((s) => {
      const o = s as Record<string, unknown>;
      return {
        id: String(o.payment_service_id ?? ""),
        name: String(o.payment_service_name ?? o.payment_service_id ?? ""),
        status: o.status,
      };
    })
    .filter((s) => s.id && (s.status === undefined || String(s.status).toLowerCase() === "active"))
    .map(({ id, name }) => ({ id, name }));
}

async function fetchServices(paymentType: "WEB_PAYMENT" | "DIGITAL_PAYMENT"): Promise<PaymentService[]> {
  const res = await fetch(`${HOST}/api/v1/merchant/list-payment-services`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      payment_type: paymentType,
      payment_status: "active",
      payment_model_reference_id: 1, // B2C / individual
    }),
    cache: "no-store",
  });
  const json = await res.json();
  if (json.response_code !== SUCCESS) return [];
  const kind = paymentType === "WEB_PAYMENT" ? "fpx" : "ewallet";
  return parseServices(json, paymentType).map((s) => ({ ...s, kind }));
}

/*
  HMAC-SHA256 over the EXACT raw body, timing-safe, fail-closed. The signature
  arrives in the x-leanx-signature header.
*/
function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature, "utf-8"), Buffer.from(expected, "utf-8"));
}

const STATUS_MAP: Record<string, string> = {
  success: "completed", paid: "completed",
  pending: "processing", processing: "processing",
  failed: "failed", declined: "failed",
  cancelled: "cancelled", refunded: "refunded",
};

export const leanx: PaymentProvider = {
  name: "leanx",

  async listPaymentServices() {
    const [fpx, ewallet] = await Promise.all([
      fetchServices("WEB_PAYMENT"),
      fetchServices("DIGITAL_PAYMENT"),
    ]);
    return { fpx, ewallet };
  },

  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    const res = await fetch(`${HOST}/api/v1/merchant/create-bill-silent`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        collection_uuid: COLLECTION_UUID,
        // 2-decimal STRING — a raw float is rejected.
        amount: (req.amountSen / 100).toFixed(2),
        invoice_ref: req.reference,
        full_name: req.fullName || "Customer",
        email: safeEmail(req.email),
        phone_number: normalisePhone(req.phone),
        redirect_url: req.returnUrl,
        callback_url: req.callbackUrl,
        payment_service_id: req.paymentServiceId,
      }),
      cache: "no-store",
    });

    const json = await res.json();
    if (json.response_code !== SUCCESS || !json.data?.redirect_url) {
      const reason = json.description || JSON.stringify(json.breakdown_errors ?? json);
      throw new Error(`LeanX create-bill failed: ${reason}`);
    }
    return { redirectUrl: json.data.redirect_url, providerRef: String(json.data.bill_no ?? "") };
  },

  async verifyWebhook(request: Request): Promise<WebhookResult> {
    // Raw body FIRST — HMAC is over the exact bytes.
    const raw = await request.text();
    const sig = request.headers.get("x-leanx-signature") ?? "";

    if (!verifySignature(raw, sig, WEBHOOK_SECRET)) {
      throw new Error("LeanX webhook signature invalid");
    }

    const body = JSON.parse(raw) as Record<string, unknown>;
    const billNo = String(body.bill_no ?? body.transaction_id ?? "");
    const invoiceRef = String(body.invoice_ref ?? body.order_id ?? "");
    const rawStatus = String(body.status ?? "").toLowerCase();
    const status = STATUS_MAP[rawStatus] ?? "processing";
    const amountSen = body.amount != null ? Math.round(parseFloat(String(body.amount)) * 100) : undefined;

    return {
      paid: status === "completed",
      status,
      providerRef: billNo || undefined,
      orderReference: invoiceRef || undefined,
      amountSen,
      raw: body,
    };
  },
};
