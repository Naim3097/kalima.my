import "server-only";

import { getOrder, getOrderWeightGrams } from "@/lib/admin";
import { easyparcelClient, getShippingConfig, type ShippingConfig } from "./config";
import { stateToIso } from "./states";
import type { PartyAddress, QuotationOption } from "./easyparcel";

/*
  Live courier rates for an order, for STAFF at booking time.

  This is not a checkout price. The customer has already been charged the
  store's flat rate (or nothing, above the free-shipping threshold); what the
  courier costs is Kalima's own cost, paid from the EasyParcel wallet. So there
  is no quote to freeze and no untrusted party to defend against — the numbers
  here just help whoever is packing choose between couriers.
*/

/** A parcel with no catalog weight still has to be priced somehow. */
const DEFAULT_WEIGHT_KG = 0.5;

export type RateQuote = {
  options: QuotationOption[];
  weightGrams: number;
  /** Why rates are unavailable, in words safe to show staff. */
  unavailable?: string;
};

/** True when we can actually reach EasyParcel for this store. */
export function connectionProblem(cfg: ShippingConfig): string | null {
  if (!cfg.enabled) return "EasyParcel is switched off in Settings → Shipping.";
  if (!cfg.connected) return "EasyParcel is not connected yet. Connect it in Settings → Shipping.";
  if (!cfg.sender.postcode || !cfg.sender.state) {
    return "Add the pickup address in Settings → Shipping before booking.";
  }
  if (!stateToIso(cfg.sender.state)) {
    return `Pickup state "${cfg.sender.state}" is not a recognised Malaysian state.`;
  }
  return null;
}

export async function getRatesForOrder(reference: string): Promise<RateQuote> {
  const [order, weightGrams, cfg] = await Promise.all([
    getOrder(reference),
    getOrderWeightGrams(reference),
    getShippingConfig(),
  ]);
  if (!order) return { options: [], weightGrams: 0, unavailable: "Order not found." };

  const problem = connectionProblem(cfg);
  if (problem) return { options: [], weightGrams, unavailable: problem };

  const addr = order.shippingAddress ?? {};
  const receiverState = stateToIso(addr.state);
  if (!addr.postcode || !receiverState) {
    return {
      options: [], weightGrams,
      unavailable: "This order has no usable delivery postcode or state.",
    };
  }

  try {
    const client = await easyparcelClient();
    const options = await client.getQuotations({
      receiverPostcode: addr.postcode,
      receiverState,
      senderPostcode: cfg.sender.postcode!,
      senderState: stateToIso(cfg.sender.state)!,
      totalWeightKg: Math.max(weightGrams / 1000, DEFAULT_WEIGHT_KG),
      parcelValue: order.totalSen / 100,
    });
    if (!options.length) {
      return { options: [], weightGrams, unavailable: "No courier serves this route right now." };
    }
    // Cheapest first — that is the decision being made.
    return { options: options.sort((a, b) => a.amountSen - b.amountSen), weightGrams };
  } catch (e) {
    // Staff can see the real reason; this never reaches a customer.
    return {
      options: [], weightGrams,
      unavailable: e instanceof Error ? e.message : "Could not reach EasyParcel.",
    };
  }
}

/** Builds the sender party from store settings. */
export function senderFrom(cfg: ShippingConfig): PartyAddress {
  return {
    name: cfg.sender.name ?? "Kalima",
    phone: cfg.sender.phone ?? "",
    line1: cfg.sender.line1 ?? "",
    line2: cfg.sender.line2 ?? undefined,
    city: cfg.sender.city ?? "",
    postcode: cfg.sender.postcode ?? "",
    state: stateToIso(cfg.sender.state) ?? "",
  };
}

/** Builds the receiver party from an order's shipping address snapshot. */
export function receiverFrom(
  addr: Record<string, string>,
  fallbackPhone: string | null,
): PartyAddress {
  return {
    name: addr.recipient ?? "Customer",
    phone: addr.phone ?? fallbackPhone ?? "",
    line1: addr.line1 ?? "",
    line2: addr.line2 || undefined,
    city: addr.city ?? "",
    postcode: addr.postcode ?? "",
    state: stateToIso(addr.state) ?? "",
  };
}
