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

/*
  Which quoted services the shop actually offers.

  PICKUP ONLY: EasyParcel quotes most couriers twice — collected from the
  sender's door, or dropped at a counter — and the shop only ever hands parcels
  to a collecting courier. And ONE PARCEL: some pickup services carry a
  minimum ("DHLeC (Pick Up with min 3 parcel(s))") that a single order cannot
  meet; the API states that only in the service name, so it is read from there.
  Booking one would be refused or surcharged after the customer had paid.
*/
function offeredForOneParcel(o: QuotationOption): boolean {
  return o.isPickup && !/\bmin\s*\d+\s*parcel/i.test(o.serviceName);
}

/*
  The courier allowlist from settings — one list for Malaysia, another for
  everywhere else, because the two are different sets of couriers.

  A match on either the courier name or the service name, case-insensitive,
  so the setting can say "J&T" or "Ninja" rather than the registered company
  name. An empty list offers everything that survived offeredForOneParcel.
*/
function allowedForDestination(cfg: ShippingConfig, country: string) {
  const list = country === "MY" ? cfg.domesticAllowedCouriers : cfg.internationalAllowedCouriers;
  const wanted = list.map((w) => w.toLowerCase());
  if (wanted.length === 0) return () => true;
  return (o: QuotationOption) => {
    const hay = `${o.courierName} ${o.serviceName}`.toLowerCase();
    return wanted.some((w) => hay.includes(w));
  };
}

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

  /*
    THE DESTINATION COUNTRY IS PART OF THE ADDRESS, and leaving it out made
    every overseas order unbookable. This read the state through stateToIso
    unconditionally, which returns null for anything that is not a Malaysian
    state — so a perfectly good Singapore address was refused as having "no
    usable postcode or state", and bookShipment turns that sentence straight
    into the error staff see. Had it got past that guard, the quotation went
    out with no country at all and came back priced as a domestic parcel.

    So: Malaysia is matched against the state list, as it must be, and
    everywhere else sends the subdivision the shopper typed. Only the postcode
    is genuinely required — upstream treats subdivision_code as optional.
  */
  const addr = order.shippingAddress ?? {};
  const country = (addr.country ?? "MY").toUpperCase();
  const receiverState = country === "MY" ? stateToIso(addr.state) : (addr.state ?? "");
  if (!addr.postcode || (country === "MY" && !receiverState)) {
    return {
      options: [], weightGrams,
      unavailable: "This order has no usable delivery postcode or state.",
    };
  }

  try {
    const client = await easyparcelClient();
    let options = await client.getQuotations({
      receiverPostcode: addr.postcode,
      receiverState: receiverState!,
      receiverCountry: country,
      senderPostcode: cfg.sender.postcode!,
      senderState: stateToIso(cfg.sender.state)!,
      totalWeightKg: Math.max(weightGrams / 1000, DEFAULT_WEIGHT_KG),
      /* The same box checkout was quoted for. Two paths pricing one parcel
         differently is a discrepancy staff would have to explain. */
      dimensions: parcelSizeFor(weightGrams),
      parcelValue: order.totalSen / 100,
    });
    /* Pickup only, as at checkout — the shop hands parcels to a collecting
       courier, and the customer's chosen service must be in this list. */
    options = options.filter(offeredForOneParcel).filter(allowedForDestination(cfg, country));
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
  ONE SENTENCE, in one place. The shopper meets it whichever way the quote
  failed, and a wording change that reached two of the three branches would
  read as two different problems.
*/
const CANNOT_QUOTE = "We can't quote delivery to that address right now.";

/*
  A failed cart quote, written where staff will actually find it.

  WHY THIS EXISTS. The shopper gets CANNOT_QUOTE and a way to reach a human;
  the real reason used to go to console.error and nowhere else, which means it
  lived in the hosting platform's log stream and nowhere durable. On 20 Aug
  2026 EasyParcel's Open API began answering every endpoint with HTTP 404, and
  the only evidence anywhere in the shop was a single row the daily connection
  check happened to write at 12:18 — every checkout that failed in between left
  nothing behind at all. This is the trail those failures should have left.

  THROTTLED to one row per fifteen minutes per distinct reason. An upstream
  outage is one fact however many shoppers meet it, and a busy evening would
  otherwise bury the back office in identical rows — with the one that mattered
  buried among them. A DIFFERENT reason always writes, because a change in how
  it is failing is the thing worth seeing.

  IT CANNOT FAIL THE QUOTE. Bookkeeping about a failure must never become a
  second failure, so every path here is swallowed. Service role with a null
  actor, as the daily check does: nobody did this, a machine noticed it.
*/
const FAILURE_THROTTLE_MS = 15 * 60 * 1000;

async function recordQuoteFailure(
  detail: string,
  context: Record<string, unknown>,
): Promise<void> {
  try {
    const db = admin();

    /* Asked of THIS reason rather than of the newest row: two failure modes
       alternating would each look new to a check that only compared against
       whatever landed last, and would write on every attempt. */
    const since = new Date(Date.now() - FAILURE_THROTTLE_MS).toISOString();
    const { data: recent } = await db
      .from("admin_audit_log")
      .select("id")
      .eq("action", "shipping.cart_quote_failed")
      .eq("meta->>detail", detail)
      .gte("created_at", since)
      .limit(1);
    if (recent?.length) return;

    await db.from("admin_audit_log").insert({
      actor_id: null,
      actor_email: null,
      action: "shipping.cart_quote_failed",
      entity_type: "settings",
      entity_id: "shipping",
      summary: `Checkout could not quote delivery to ${context.country ?? "an address"} — ${detail}`,
      meta: { detail, ...context },
    });
  } catch {
    /* Deliberately ignored — see above. */
  }
}

/*
  Live courier rates for a CART, before any order exists — the checkout half.

  Distinct from getRatesForOrder above, which quotes an order the customer has
  already been charged for. Here the quote IS the price: whatever comes back is
  what an overseas shopper picks from and pays. So the options are frozen server
  side (issue_shipping_quote) and the checkout carries only an id — see the
  shipping_quotes migration for why the browser is never handed an amount.

  Malaysia reaches this only in 'courier' mode (Admin › Shipping). In 'zone'
  mode its price is a rate the database already knows and the checkout never
  asks. The caller decides; this function quotes whatever address it is given.

  PICKUP SERVICES ONLY. EasyParcel offers most couriers twice — collected from
  the sender's door, or dropped at a counter — and the shop only ever hands
  parcels to a collecting courier. Offering a drop-off rate would price a
  service nobody here performs.
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
    await recordQuoteFailure(problem, {
      country: input.country,
      postcode: input.postcode,
      subdivision: input.subdivision,
      parcel_value_rm: input.parcelValueRm,
    });
    return { unavailable: CANNOT_QUOTE };
  }

  /* EasyParcel prices Malaysia on the ISO subdivision code, and a wrong one
     silently misprices West vs East — so the state name the shopper picked is
     mapped here, once, and an unrecognised one is refused rather than sent. */
  const receiverState =
    input.country === "MY" ? stateToIso(input.subdivision) : input.subdivision;
  if (input.country === "MY" && !receiverState) {
    return { unavailable: "Please choose a state to quote delivery." };
  }

  const weightGrams = await cartWeightGrams(input.lines);
  const totalWeightKg = Math.max(weightGrams / 1000, DEFAULT_WEIGHT_KG);

  let options: QuotationOption[];
  try {
    const client = await easyparcelClient();
    options = await client.getQuotations({
      receiverPostcode: input.postcode,
      receiverState: receiverState!,
      receiverCountry: input.country,
      senderPostcode: cfg.sender.postcode!,
      senderState: stateToIso(cfg.sender.state)!,
      totalWeightKg,
      dimensions: parcelSizeFor(weightGrams),
      parcelValue: input.parcelValueRm,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[shipping] getQuotations failed:", detail);
    await recordQuoteFailure(detail, {
      country: input.country,
      postcode: input.postcode,
      subdivision: input.subdivision,
      weight_grams: weightGrams,
      parcel_value_rm: input.parcelValueRm,
    });
    return { unavailable: CANNOT_QUOTE };
  }

  options = options.filter(offeredForOneParcel).filter(allowedForDestination(cfg, input.country));
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
    const detail = `issue_shipping_quote: ${error?.message ?? "no quote id returned"}`;
    console.error("[shipping] issue_shipping_quote failed:", error?.message);
    await recordQuoteFailure(detail, {
      country: input.country,
      postcode: input.postcode,
      subdivision: input.subdivision,
      weight_grams: weightGrams,
      parcel_value_rm: input.parcelValueRm,
      option_count: options.length,
    });
    return { unavailable: CANNOT_QUOTE };
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

/*
  Builds the receiver party from an order's shipping address snapshot.

  THE COUNTRY TRAVELS. It used to be left off, which let the client default it
  to MY — booking an overseas parcel as a domestic one, at a domestic address
  the courier could not deliver to. The snapshot has always carried it.

  The subdivision follows the same rule quoting uses: an ISO code for Malaysia,
  because that is what the state list produces and what the API documents, and
  otherwise whatever the shopper typed. The field is optional upstream, so a
  subdivision we cannot map is better sent as-is than blanked.
*/
export function receiverFrom(
  addr: Record<string, string>,
  fallbackPhone: string | null,
  fallbackEmail?: string | null,
): PartyAddress {
  const country = (addr.country ?? "MY").toUpperCase();
  return {
    name: addr.recipient ?? "Customer",
    phone: addr.phone ?? fallbackPhone ?? "",
    email: addr.email ?? fallbackEmail ?? undefined,
    line1: addr.line1 ?? "",
    line2: addr.line2 || undefined,
    city: addr.city ?? "",
    postcode: addr.postcode ?? "",
    state: (country === "MY" ? stateToIso(addr.state) : addr.state) ?? "",
    country,
  };
}
