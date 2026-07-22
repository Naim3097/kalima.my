import "server-only";

import type { PaymentProvider } from "./types";
import { leanx, leanxConfigured } from "./leanx";

/*
  The active payment provider, or null when unconfigured. With no LeanX
  credentials the checkout stops at "order received, payment pending" rather
  than pretending a gateway exists — an unconfigured gateway is visibly
  unconfigured, never a silent success.
*/
export function getPaymentProvider(): PaymentProvider | null {
  return leanxConfigured() ? leanx : null;
}

export type { PaymentProvider, PaymentService } from "./types";
