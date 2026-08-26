/*
  Payment gateway seam. LeanX is the provider; the interface is shaped to its
  Silent Bill flow (LEANX_SAAS_INTEGRATION_GUIDE.md):

    1. listPaymentServices() → the FPX banks / e-wallets the shopper picks from
    2. createCheckout(req + chosen service) → a hosted redirect_url + bill_no
    3. LeanX webhook → verifyWebhook() → the ONLY trusted "paid" signal

  The order/stock logic behind this never changes when the provider does.

  Fixed security contract, regardless of provider:
  - an order is marked paid ONLY in the webhook path, after the signature
    verifies AND the amount matches what we stored — never on the browser return
  - the amount is decided server-side from the order, never from the client
*/

export type PaymentServiceKind = "fpx" | "ewallet" | "bnpl" | "card";

export type PaymentService = {
  id: string; // LeanX payment_service_id, or the provider's own option id
  name: string;
  kind: PaymentServiceKind;
  /*
    Which provider owns this option.

    Load-bearing now that more than one gateway is configured: the shopper picks
    a single id out of one merged list, and startPayment has to know whose API to
    call with it. Without this the id alone is ambiguous — "atome" and a LeanX
    payment_service_id are both just strings.
  */
  provider: string;
};

export type CheckoutRequest = {
  /** Our order reference — becomes LeanX invoice_ref. */
  reference: string;
  amountSen: number;
  fullName: string;
  email: string;
  phone: string;
  /** The bank/e-wallet the shopper chose (payment_service_id). */
  paymentServiceId: string;
  /** Where the gateway returns the shopper (display only — never trusted). */
  returnUrl: string;
  /*
    Where to send a shopper who abandoned the payment, when the gateway
    distinguishes that from success. Atome does (paymentCancelUrl); LeanX has a
    single redirect and ignores this. Optional so the LeanX adapter needs no
    change to keep compiling.
  */
  cancelUrl?: string;
  /** Our webhook endpoint (server-built, never from a request header). */
  callbackUrl: string;
  /*
    The delivery address, for gateways that need it.

    Atome's MY merchant configuration REQUIRES a shipping address and rejects
    create-payment without one ("Your request is missing customer shipping
    address") — the OpenAPI spec marks the field optional, so this is a
    per-merchant rule that only shows up against a real account. LeanX asks for
    no address at all and ignores this.

    Optional on the type so LeanX's adapter needs no change, but the Atome
    adapter refuses without it rather than letting Atome do the refusing.
  */
  shippingAddress?: {
    line1: string;
    line2?: string;
    city: string;
    postcode: string;
    state: string;
    /** ISO-3166 alpha-2. "MY" for every order we take today. */
    country?: string;
  };
  /*
    The order's lines and money breakdown, for gateways that itemise.

    Atome requires per-item detail and rejects create-payment without it
    ("Your request is missing item information"). The shipping and tax parts
    come too, so the itemised figures reconcile against `amountSen` on an order
    that carried a discount — items alone would not add up. LeanX takes a single
    amount and ignores all of it.
  */
  lines?: {
    sku: string;
    name: string;
    /** Colour · size, for the shopper to recognise on the gateway's page. */
    variation?: string;
    qty: number;
    unitPriceSen: number;
  }[];
  /** Pre-discount goods total. */
  subtotalSen?: number;
  shippingSen?: number;
  taxSen?: number;
};

export type CheckoutSession = {
  /** URL to redirect the shopper to for payment. */
  redirectUrl: string;
  /** LeanX bill_no — stored as the payment's provider_ref. */
  providerRef: string;
};

export type WebhookResult = {
  /** True only when the signature verified AND the event means paid. */
  paid: boolean;
  /** Mapped internal status (completed/processing/failed/cancelled/refunded). */
  status: string;
  /** LeanX bill_no. */
  providerRef?: string;
  /** LeanX invoice_ref (our order reference). */
  orderReference?: string;
  amountSen?: number;
  raw?: unknown;
};

/*
  The result of asking the gateway directly what happened to a bill.

  `status: "unknown"` is load-bearing. LeanX's status endpoint is flaky and
  answers 404 for bills that exist; treating a failed lookup as "failed" would
  cancel paid orders. Only an explicit verdict may move an order.
*/
export type PaymentStatus = {
  status: "completed" | "processing" | "failed" | "cancelled" | "refunded" | "unknown";
  amountSen?: number;
  raw?: unknown;
};

export interface PaymentProvider {
  readonly name: string;
  /*
    How long one payment attempt stays completable at this gateway, in minutes.

    THIS IS A SAFETY BOUND, NOT A DISPLAY HINT. The expiry sweep cancels orders
    the gateway does not confirm as paid, and a failed status lookup is
    indistinguishable from "never existed" — so the only thing separating "safe
    to cancel" from "the shopper is mid-payment on a page that still works" is
    how long this gateway keeps an attempt alive. LeanX's FPX bill dies in
    minutes; Atome's lives twelve hours. Cancelling inside that window charges a
    customer for an order we have already closed.

    Set it from the gateway's documented lifetime, and round UP: the cost of
    being generous is an order that expires late, and the cost of being mean is
    a customer's money.
  */
  readonly payableWindowMinutes: number;
  /** Active FPX banks + e-wallets for the shopper to choose. */
  listPaymentServices(): Promise<{ fpx: PaymentService[]; ewallet: PaymentService[] }>;
  /** Create a hosted-payment session for an order + chosen service. */
  createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  /** Verify a webhook request (JWT envelope or HMAC header) and extract the outcome. */
  verifyWebhook(request: Request): Promise<WebhookResult>;
  /*
    Pull a bill's status. Needed because callbacks fire on SUCCESS ONLY —
    a cancelled or failed bill is never pushed, so without this an abandoned
    checkout stays pending forever.
  */
  checkStatus(billNo: string): Promise<PaymentStatus>;
}
