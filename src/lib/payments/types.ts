/*
  Payment gateway seam. LeanX is the chosen provider (integration .md pending),
  but nothing in the order/checkout/webhook flow depends on LeanX specifically
  — it all talks to this interface. Adding LeanX = implementing PaymentProvider
  and registering it in ./index.ts. No order logic changes.

  The security contract is fixed regardless of provider:
  - createCheckout() hands the shopper off to the gateway's hosted page
  - an order is marked paid ONLY in verifyWebhook(), after the signature checks
    out — never from the browser's return redirect
*/

export type CheckoutRequest = {
  orderId: string;
  reference: string;
  amountSen: number;
  currency: string;
  customerEmail: string;
  /** Where the gateway returns the shopper after payment (informational only). */
  returnUrl: string;
};

export type CheckoutSession = {
  /** URL to redirect the shopper to for payment. */
  redirectUrl: string;
  /** The provider's id for this attempt, if issued now. */
  providerRef?: string;
};

export type WebhookResult = {
  /** True only when the signature verified and the event means "paid". */
  paid: boolean;
  orderReference?: string;
  providerRef?: string;
  amountSen?: number;
  raw?: unknown;
};

export interface PaymentProvider {
  readonly name: string;
  /** Create a hosted-payment session for an order. */
  createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  /** Verify a webhook request and extract the payment outcome. */
  verifyWebhook(request: Request): Promise<WebhookResult>;
}
