import "server-only";

import type { PaymentProvider } from "./types";

/*
  Resolves the active payment provider. LeanX drops in here once the
  integration .md arrives:

    import { leanx } from "./leanx";
    return leanx;

  Until then this returns null and the checkout stops at "order created,
  payment pending" rather than pretending a gateway exists. Nothing else in the
  flow needs to change when LeanX is wired — see ./types.ts.
*/
export function getPaymentProvider(): PaymentProvider | null {
  // Pending: LeanX. Deliberately not a mock — an unconfigured gateway should be
  // visibly unconfigured, not silently "succeed".
  return null;
}

export type { PaymentProvider } from "./types";
