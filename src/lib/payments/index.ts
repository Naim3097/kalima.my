import "server-only";

import type { PaymentProvider, PaymentService } from "./types";
import { leanx, leanxConfigured } from "./leanx";
import { atome, atomeConfigured, ATOME_MIN_SEN } from "./atome";

/*
  Payment provider registry.

  There are two gateways now — LeanX for FPX and e-wallets, Atome for
  instalments — and the shopper picks one option out of a single merged list. So
  the question "whose API is this id for?" has to be answerable, and answerable
  in one place rather than at each call site.

  An unconfigured provider is simply absent from the registry. Nothing anywhere
  substitutes a mock: with no credentials at all, checkout stops at "order
  received, payment pending" rather than pretending a gateway exists — the same
  rule the webhook follows in refusing to invent a paid state.
*/

const ALL: { provider: PaymentProvider; configured: () => boolean }[] = [
  { provider: leanx, configured: leanxConfigured },
  { provider: atome, configured: atomeConfigured },
];

/** Every gateway that currently has credentials. */
export function configuredProviders(): PaymentProvider[] {
  return ALL.filter((p) => p.configured()).map((p) => p.provider);
}

export function providerByName(name: string): PaymentProvider | null {
  const found = ALL.find((p) => p.provider.name === name);
  return found && found.configured() ? found.provider : null;
}

/*
  The default provider, for callers that only need "is there a gateway at all".

  Deliberately LeanX-first rather than "whichever is configured": it carries FPX,
  which is how most Malaysian orders are actually paid, and a caller asking this
  vague a question should get the ordinary path.
*/
export function getPaymentProvider(): PaymentProvider | null {
  return configuredProviders()[0] ?? null;
}

/*
  Every way to pay, grouped for the picker.

  `bnpl` is filtered by `totalSen` because Atome's RM10 floor is a hard reject at
  create-payment time. Offering an option that cannot succeed and only saying so
  after the shopper has committed to it is a worse failure than not offering it —
  the gate belongs here, where the order total is known.

  A provider whose list call fails is skipped rather than fatal: one gateway
  being down must not take the whole checkout with it.
*/
export async function listAllPaymentServices(totalSen: number): Promise<{
  fpx: PaymentService[];
  ewallet: PaymentService[];
  bnpl: PaymentService[];
}> {
  const results = await Promise.all(
    configuredProviders().map(async (p) => {
      try {
        return await p.listPaymentServices();
      } catch {
        return { fpx: [], ewallet: [] };
      }
    }),
  );

  const flat = results.flatMap((r) => [...r.fpx, ...r.ewallet]);

  return {
    fpx: flat.filter((s) => s.kind === "fpx"),
    ewallet: flat.filter((s) => s.kind === "ewallet"),
    bnpl: flat.filter((s) => s.kind === "bnpl" && totalSen >= ATOME_MIN_SEN),
  };
}

/*
  Which provider owns a chosen option id.

  Atome names itself, so it is matched directly. Anything else is a LeanX
  payment_service_id — those are opaque numbers from LeanX's catalogue and cannot
  be recognised by shape, so LeanX is the fallback rather than the result of a
  lookup. If a third gateway ever arrives with its own opaque ids, this is the
  function that has to learn to disambiguate them, and the only one.
*/
export function providerForService(serviceId: string): PaymentProvider | null {
  if (serviceId === "atome") return providerByName("atome");
  return providerByName("leanx");
}

/*
  The reference to give Atome for a payment ATTEMPT.

  Atome's create-payment is idempotent on referenceId and it cancels unpaid
  payments after 12 hours. So a shopper who abandons at noon and returns at
  midnight must not be handed back the cancelled record — reusing the reference
  would return exactly that, with no payable redirectUrl and no obvious reason
  why. The nth attempt therefore appends `-n`.

  The plain order reference travels separately as merchantReferenceId, so
  settlement reports still read `KLM-10287` whatever the attempt count.
  `attempt` is the number of Atome payment rows this order already has.
*/
export function buildAtomeReference(orderReference: string, attempt: number): string {
  return attempt <= 0 ? orderReference : `${orderReference}-${attempt + 1}`;
}

export { ATOME_MIN_SEN } from "./atome";
export type { PaymentProvider, PaymentService } from "./types";
