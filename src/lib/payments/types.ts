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

export type PaymentServiceKind = "fpx" | "ewallet";

export type PaymentService = {
  id: string; // LeanX payment_service_id
  name: string;
  kind: PaymentServiceKind;
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
  /** Where LeanX returns the shopper (display only — never trusted). */
  returnUrl: string;
  /** Our webhook endpoint (server-built, never from a request header). */
  callbackUrl: string;
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
