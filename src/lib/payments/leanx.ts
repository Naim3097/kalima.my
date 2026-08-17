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

// The human-readable name key varies by account/API version. Live sandbox
// returns `name` ("Affin Bank"); the guide documented `payment_service_name`.
// Try both plus known aliases, falling back to the id so the picker is never
// blank. (Verified against a live list-payment-services response.)
const NAME_KEYS = [
  "name",
  "payment_service_name",
  "display_name",
  "bank_name",
  "bank_display_name",
  "channel_name",
  "title",
  "label",
] as const;

/* Empty when nothing usable is found — the caller drops the entry. A button
   labelled "65" is worse than one bank fewer. */
function pickName(o: Record<string, unknown>): string {
  for (const k of NAME_KEYS) {
    const v = o[k];
    if (typeof v === "string" && v.trim() && v.trim() !== String(o.payment_service_id)) {
      return v.trim().replace(/ B2B$/i, "");
    }
  }
  return "";
}

// Active unless a status field explicitly says otherwise. Live responses carry
// `record_status` ("Active") / `record_status_id` (1); older shapes use
// `status`. Absent → treat as active (the request already filters active).
function isActive(o: Record<string, unknown>): boolean {
  // A numeric record_status_id is the most explicit signal; 1 = active.
  if (o.record_status_id != null && o.record_status_id !== "") {
    return String(o.record_status_id) === "1";
  }
  const s = o.status ?? o.payment_status ?? o.record_status ?? o.payment_service_status;
  if (s === undefined || s === null || s === "") return true;
  const v = String(s).toLowerCase();
  return v === "active" || v === "1" || v === "true";
}

function normaliseList(arr: unknown[]): { id: string; name: string }[] {
  return arr
    .map((s) => {
      const o = s as Record<string, unknown>;
      return { id: String(o.payment_service_id ?? ""), name: pickName(o), ok: isActive(o) };
    })
    .filter((s) => s.id && s.name && s.ok)
    .map(({ id, name }) => ({ id, name }));
}

// One list-payment-services call for a given type + payment model.
async function fetchServicesForModel(
  paymentType: "WEB_PAYMENT" | "DIGITAL_PAYMENT",
  model: 1 | 2,
): Promise<{ id: string; name: string }[]> {
  const res = await fetch(`${HOST}/api/v1/merchant/list-payment-services`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      payment_type: paymentType,
      payment_status: "active",
      payment_model_reference_id: model, // 1 = B2C / individual, 2 = B2B / corporate
    }),
    cache: "no-store",
  });
  const json = await res.json();
  if (json.response_code !== SUCCESS) return [];
  return parseServices(json, paymentType);
}

/*
  Query both payment models and merge — some banks only surface under B2B
  (BNP Paribas, Deutsche Bank and the corporate Citibank arrive that way).

  Dedup is by NAME, not payment_service_id: a bank offered under both models
  carries a different id in each, so an id-keyed set keeps both and the shopper
  is asked to choose between "AmBank" and "AMBANK". On this account that was ten
  banks listed twice. B2C is listed first and wins, which also keeps the better
  casing — the corporate list SHOUTS.
*/
async function fetchServices(paymentType: "WEB_PAYMENT" | "DIGITAL_PAYMENT"): Promise<PaymentService[]> {
  const kind = paymentType === "WEB_PAYMENT" ? "fpx" : "ewallet";
  const [b2c, b2b] = await Promise.all([
    fetchServicesForModel(paymentType, 1),
    fetchServicesForModel(paymentType, 2),
  ]);

  /*
    "CIMB Clicks" and "CIMB BANK" are the same bank to a shopper, as are
    "Affin Bank" and "AFFINMAX". Strip separators FIRST, then the boilerplate —
    matching on word boundaries misses the run-together corporate spellings,
    which is exactly where the duplicates come from.
  */
  const key = (name: string) =>
    name.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/BANK|BERHAD|PERSONAL|CLICKS|MAX/g, "");

  const seen = new Set<string>();
  const merged: PaymentService[] = [];
  for (const s of [...b2c, ...b2b]) {
    const k = key(s.name) || s.id;
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push({ ...s, kind, provider: "leanx" });
  }
  return merged;
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

const b64urlDecode = (s: string) =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");

/*
  The other callback envelope: `{ data: "<HS256 JWT>" }` with no signature
  header, the token signed with the collection's Hash Key. The token IS the
  authentication. Returns the claims, or null if anything fails to verify.

  `alg` is pinned to HS256 deliberately. Trusting the header's own `alg` lets a
  forged token nominate "none", at which point the check verifies nothing.
*/
function verifyJwtHS256(token: string, secret: string): Record<string, unknown> | null {
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let alg: unknown;
  try {
    alg = (JSON.parse(b64urlDecode(headerB64)) as Record<string, unknown>).alg;
  } catch {
    return null;
  }
  if (alg !== "HS256") return null;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");
  if (signatureB64.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signatureB64), Buffer.from(expected))) return null;

  try {
    return JSON.parse(b64urlDecode(payloadB64)) as Record<string, unknown>;
  } catch {
    return null;
  }
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
        /*
          NUMBER, not string. We carry the id as a string everywhere else
          (it arrives inside form values and URLs), but the API types this as
          a number and a live account rejected the string form with an
          undocumented `4566 FAILED` — every payment fails. Guide §0 item 2.
        */
        payment_service_id: Number(req.paymentServiceId),
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

  /*
    Two callback envelopes exist and are indistinguishable from the outside:

      1. { data: "<HS256 JWT>" }        — the token is the proof, no header
      2. plain JSON + x-leanx-signature — HMAC over the raw body

    Which one an account sends is not something we control, so accept either.
    Each stands on its own proof; neither weakens the other, and an unsigned
    body still fails closed. Guide §0 item 3.
  */
  async verifyWebhook(request: Request): Promise<WebhookResult> {
    // Raw body FIRST — the HMAC is over the exact bytes, before any parsing.
    const raw = await request.text();

    let outer: Record<string, unknown>;
    try {
      outer = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error("LeanX webhook body is not JSON");
    }

    let body: Record<string, unknown>;
    if (typeof outer.data === "string") {
      const claims = verifyJwtHS256(outer.data, WEBHOOK_SECRET);
      if (!claims) throw new Error("LeanX webhook JWT invalid");
      body = claims;
    } else {
      const sig = request.headers.get("x-leanx-signature") ?? "";
      if (!verifySignature(raw, sig, WEBHOOK_SECRET)) {
        throw new Error("LeanX webhook signature invalid");
      }
      body = outer;
    }

    /*
      Order resolution is anchored on the bill number we stored at creation,
      never on a ref the payload can choose — that is the primary key and it is
      not attacker-nameable.

      Our own reference is carried too, as a secondary check, but it is nested:
      a real captured callback (order KLM-10287) put it at
      `client_data.invoice_ref`, with the top-level `order_id` being the literal
      string "None". Reading only the top level made that fallback dead, leaving
      billNo the single point of failure — if it ever failed to match, the
      webhook 200s with "order not found" and the order silently never settles.
      So we look inside client_data too.
    */
    const clientData = (body.client_data ?? {}) as Record<string, unknown>;
    const billNo = String(
      body.bill_no ?? body.invoice_no ?? clientData.merchant_invoice_no ?? body.transaction_id ?? "",
    );
    const refRaw = String(
      body.invoice_ref ?? clientData.invoice_ref ?? body.merchant_invoice_no ?? body.order_id ?? "",
    );
    const invoiceRef = refRaw && refRaw !== "None" ? refRaw : "";

    const rawStatus = String(body.status ?? body.invoice_status ?? "").toLowerCase();
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

  /*
    Pull a bill's status. The endpoint takes invoice_no as a QUERY PARAM with no
    body — sending a JSON body to /transaction-status instead answers
    "Requested endpoint is forbidden", which reads like a missing account
    permission and is not. Guide §0 item 4.

    Every failure maps to "unknown", never "failed": a flaky lookup must not be
    able to cancel a paid order.
  */
  async checkStatus(billNo: string) {
    if (!billNo) return { status: "unknown" as const };
    try {
      const res = await fetch(
        `${HOST}/api/v1/merchant/manual-checking-transaction?invoice_no=${encodeURIComponent(billNo)}`,
        { method: "POST", headers: headers(), cache: "no-store" },
      );
      const json = await res.json();
      if (json.response_code !== SUCCESS) return { status: "unknown" as const, raw: json };

      const details = json.data?.transaction_details ?? {};
      const mapped = STATUS_MAP[String(details.invoice_status ?? "").toLowerCase()];
      if (!mapped) return { status: "unknown" as const, raw: json };

      return {
        status: mapped as PaymentStatus["status"],
        amountSen:
          details.amount != null ? Math.round(parseFloat(String(details.amount)) * 100) : undefined,
        raw: json,
      };
    } catch {
      return { status: "unknown" as const };
    }
  },
};
