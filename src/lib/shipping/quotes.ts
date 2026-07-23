import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import type { QuotationOption } from "./easyparcel";
import { easyparcelClient, getShippingConfig } from "./config";
import { stateToIso } from "./states";

/*
  Server-issued shipping quotes.

  The rule this exists to enforce is Kalima's existing one: the client never
  sends a price. Checkout receives a `quoteId` and a list of couriers; when the
  order is created the server looks the amount back up by (quoteId, serviceId)
  with expiry enforced. A tampered client can choose a different courier — never
  a different price.

  Quotes live 30 minutes, which comfortably covers a checkout without letting a
  stale rate be redeemed days later after the courier has repriced.
*/

const QUOTE_TTL_MINUTES = 30;
/** A parcel with no catalog weight still has to be priced somehow. */
const DEFAULT_WEIGHT_KG = 0.5;

export type ShippingMethod = "free" | "flat" | "easyparcel" | "fallback";

export type QuoteResult = {
  quoteId: string | null;
  method: ShippingMethod;
  options: QuotationOption[];
  fallbackUsed: boolean;
};

function admin() {
  const client = createAdminClient();
  if (!client) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return client;
}

function synthetic(id: string, name: string, amountSen: number): QuotationOption {
  return {
    serviceId: id, serviceName: name, courierName: "Kalima",
    amountSen, codAvailable: false,
  };
}

/*
  Prices a cart for delivery.

  The ladder mirrors the reference integration: a live rate when EasyParcel is
  connected and usable, otherwise the store's flat rate so a sale never blocks
  on a third party being up. Free shipping above the threshold short-circuits
  everything — there is no point quoting couriers for a price the customer will
  not pay.
*/
export async function quoteShipping(input: {
  postcode: string;
  state: string;
  city?: string;
  subtotalSen: number;
  weightGrams: number;
}): Promise<QuoteResult> {
  const cfg = await getShippingConfig();

  // Free-shipping threshold wins outright.
  if (cfg.freeShippingThresholdSen > 0 && input.subtotalSen >= cfg.freeShippingThresholdSen) {
    return await issue("free", [synthetic("free", "Free shipping", 0)], input, false);
  }

  const flatOption = synthetic("flat", "Standard delivery", cfg.flatShippingSen);

  // Not using EasyParcel at all — flat rate, no external call.
  if (!cfg.enabled || !cfg.connected) {
    return await issue("flat", [flatOption], input, false);
  }

  const receiverState = stateToIso(input.state);
  const senderState = stateToIso(cfg.sender.state);
  const senderPostcode = cfg.sender.postcode;

  // Connected but not configured to ship from anywhere — fall back rather than
  // send EasyParcel a request we know is invalid.
  if (!receiverState || !senderState || !senderPostcode) {
    return await issue("fallback", [flatOption], input, true);
  }

  try {
    const client = await easyparcelClient();
    const options = await client.getQuotations({
      receiverPostcode: input.postcode,
      receiverState,
      senderPostcode,
      senderState,
      totalWeightKg: Math.max(input.weightGrams / 1000, DEFAULT_WEIGHT_KG),
      parcelValue: input.subtotalSen / 100,
    });

    if (!options.length) return await issue("fallback", [flatOption], input, true);
    return await issue("easyparcel", options, input, false);
  } catch (e) {
    // A dead token or an outage is the shop's problem to fix, but the customer
    // should still be able to buy. Fall back when allowed; otherwise let the
    // caller decide what to show — it must never leak the upstream reason.
    if (!cfg.fallbackEnabled) throw e;
    return await issue("fallback", [flatOption], input, true);
  }
}

/*
  Freezes the options. Persisting is best-effort: if the insert fails the rates
  are still returned with a null quoteId, and order creation then falls back to
  the store's flat rate rather than trusting anything the client sent.
*/
async function issue(
  method: ShippingMethod,
  options: QuotationOption[],
  inputs: Record<string, unknown>,
  fallbackUsed: boolean,
): Promise<QuoteResult> {
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MINUTES * 60_000).toISOString();
  try {
    const { data, error } = await admin()
      .from("shipping_quotes")
      .insert({
        method,
        options: options.map((o) => ({
          service_id: o.serviceId, service_name: o.serviceName,
          courier_name: o.courierName, amount_sen: o.amountSen,
          cod_available: o.codAvailable,
        })),
        inputs,
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (error) throw error;

    // Cheap opportunistic GC — there is no separate sweeper job.
    await admin().from("shipping_quotes").delete().lt("expires_at", new Date().toISOString());

    return { quoteId: data.id as string, method, options, fallbackUsed };
  } catch {
    return { quoteId: null, method, options, fallbackUsed };
  }
}

/*
  Resolves the authoritative shipping charge for an order.

  This is the only function order creation may use. It never accepts a price
  from the caller: an unusable quote falls back to the store's flat rate.
*/
export async function resolveShippingSen(params: {
  quoteId: string | null;
  serviceId: string | null;
  subtotalSen: number;
}): Promise<{ shippingSen: number; serviceId: string | null; courierName: string | null }> {
  const cfg = await getShippingConfig();

  if (cfg.freeShippingThresholdSen > 0 && params.subtotalSen >= cfg.freeShippingThresholdSen) {
    return { shippingSen: 0, serviceId: "free", courierName: null };
  }

  const fallback = {
    shippingSen: cfg.flatShippingSen,
    serviceId: "flat",
    courierName: null as string | null,
  };

  if (!params.quoteId || !params.serviceId) return fallback;

  const { data, error } = await admin()
    .from("shipping_quotes")
    .select("options, expires_at")
    .eq("id", params.quoteId)
    .maybeSingle();
  if (error || !data) return fallback;

  // Expiry is enforced here, not by a sweeper — a deleted-late row must not be
  // redeemable just because the GC hasn't run.
  if (new Date(data.expires_at as string).getTime() <= Date.now()) return fallback;

  const match = (data.options as Record<string, unknown>[]).find(
    (o) => String(o.service_id) === params.serviceId,
  );
  if (!match) return fallback;

  return {
    shippingSen: Number(match.amount_sen) || 0,
    serviceId: String(match.service_id),
    courierName: (match.courier_name as string | null) ?? null,
  };
}
