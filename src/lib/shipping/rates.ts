import "server-only";

import { getOrder, getOrderWeightGrams } from "@/lib/admin";
import { easyparcelClient, getShippingConfig, type ShippingConfig } from "./config";
import { stateToIso } from "./states";
import { parcelSizeFor } from "./countries";
import { createAdminClient } from "@/lib/supabase/server";

/* Service role: quoting reads the catalogue's weights and writes the frozen
   quote, neither of which belongs to the shopper's session. */
function admin() {
  const client = createAdminClient();
  if (!client) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return client;
}
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

/*
  Live courier rates for a CART, before any order exists — the checkout half.

  Distinct from getRatesForOrder above, which quotes an order the customer has
  already been charged for. Here the quote IS the price: whatever comes back is
  what an overseas shopper picks from and pays. So the options are frozen server
  side (issue_shipping_quote) and the checkout carries only an id — see the
  shipping_quotes migration for why the browser is never handed an amount.

  Malaysia never reaches this. Its price is a zone rate the database already
  knows, and asking a Malaysian shopper to choose a courier would be a worse
  checkout for no gain.
*/
export type CartQuote = {
  quoteId: string;
  options: QuotationOption[];
  weightGrams: number;
};

export type CartQuoteFailure = { unavailable: string };

export async function quoteForCart(input: {
  lines: { variant_id: string; qty: number }[];
  country: string;
  postcode: string;
  /** ISO 3166-2 for Malaysia; for elsewhere, whatever the shopper typed. */
  subdivision: string;
  parcelValueRm: number;
}): Promise<CartQuote | CartQuoteFailure> {
  const cfg = await getShippingConfig();

  const problem = connectionProblem(cfg);
  if (problem) {
    /* Staff wording ("connect it in Settings") would be nonsense to a customer,
       and the real reason is the shop's business. They get one honest sentence
       and a way to reach a human; the detail is logged. */
    console.error("[shipping] cart quote unavailable:", problem);
    return { unavailable: "We can't quote delivery to that address right now." };
  }

  const weightGrams = await cartWeightGrams(input.lines);
  const totalWeightKg = Math.max(weightGrams / 1000, DEFAULT_WEIGHT_KG);

  let options: QuotationOption[];
  try {
    const client = await easyparcelClient();
    options = await client.getQuotations({
      receiverPostcode: input.postcode,
      receiverState: input.subdivision,
      receiverCountry: input.country,
      senderPostcode: cfg.sender.postcode!,
      senderState: stateToIso(cfg.sender.state)!,
      totalWeightKg,
      dimensions: parcelSizeFor(weightGrams),
      parcelValue: input.parcelValueRm,
    });
  } catch (e) {
    console.error("[shipping] getQuotations failed:", e instanceof Error ? e.message : e);
    return { unavailable: "We can't quote delivery to that address right now." };
  }

  if (!options.length) {
    return { unavailable: "No courier we work with delivers to that address." };
  }

  /*
    Frozen before it is shown. If this insert fails the rates are NOT returned:
    an option the shopper can pick but the server cannot price later would be
    refused at the last step, which is a worse moment to find out.
  */
  const { data, error } = await admin().rpc("issue_shipping_quote", {
    p_options: options.map((o) => ({
      service_id: o.serviceId,
      service_name: o.serviceName,
      courier: o.courierName,
      amount_sen: o.amountSen,
      delivery_duration: o.deliveryDuration,
    })),
    p_inputs: {
      country: input.country,
      postcode: input.postcode,
      subdivision: input.subdivision,
      weight_grams: weightGrams,
      parcel_value_rm: input.parcelValueRm,
    },
  });
  if (error || !data) {
    console.error("[shipping] issue_shipping_quote failed:", error?.message);
    return { unavailable: "We can't quote delivery to that address right now." };
  }

  return { quoteId: data as string, options, weightGrams };
}

/*
  What the cart weighs, from the catalogue.

  A variant with no weight falls back to the same default a whole parcel does,
  so one unmeasured piece cannot quote an order at nothing.
*/
async function cartWeightGrams(lines: { variant_id: string; qty: number }[]): Promise<number> {
  if (!lines.length) return 0;

  const { data, error } = await admin()
    .from("product_variants")
    .select("id, weight_grams")
    .in("id", lines.map((l) => l.variant_id));
  if (error) throw new Error(`cartWeightGrams failed: ${error.message}`);

  const byId = new Map((data ?? []).map((v) => [v.id as string, (v.weight_grams as number) ?? 0]));
  return lines.reduce(
    (sum, l) => sum + (byId.get(l.variant_id) || DEFAULT_WEIGHT_KG * 1000) * l.qty,
    0,
  );
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
