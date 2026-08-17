"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  countPaymentAttempts,
  createOrder,
  resolveCartLines,
  validateDiscount,
  getOrderForCheckout,
  recordPendingPayment,
  type CartRef,
  type DiscountResult,
} from "@/lib/commerce";
import { buildAtomeReference, configuredProviders, providerForService } from "@/lib/payments";
import { sendOrderReceivedEmail } from "@/lib/email";

/*
  Checkout server actions. The cart arrives from the client as CartRef[]
  (slug + colour + size + qty); the client's money is never trusted — prices,
  discount and shipping are all recomputed server-side in create_order.
*/

export type PlaceOrderState = { error: string } | undefined;

const MY_STATES = new Set([
  "Selangor", "Kuala Lumpur", "Johor", "Penang", "Perak", "Kedah", "Kelantan",
  "Terengganu", "Pahang", "Negeri Sembilan", "Melaka", "Perlis", "Sabah",
  "Sarawak", "Putrajaya", "Labuan",
]);

/** Live discount check for the "Apply" button. */
export async function checkDiscount(
  code: string,
  cart: CartRef[],
): Promise<DiscountResult & { subtotalSen: number }> {
  const { subtotalSen } = await resolveCartLines(cart);
  const result = await validateDiscount(code, subtotalSen);
  return { ...result, subtotalSen };
}

export async function placeOrder(
  cart: CartRef[],
  form: {
    email: string;
    phone: string;
    recipient: string;
    line1: string;
    line2: string;
    city: string;
    postcode: string;
    state: string;
    shippingMethod: string;
    discountCode: string;
    /** Points the shopper wants to spend; clamped server-side. */
    redeemPoints?: number;
  },
): Promise<PlaceOrderState> {
  if (!cart.length) return { error: "Your bag is empty." };

  const email = form.email.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: "Enter a valid email address." };
  }
  /*
    Phone is required, not optional. The courier needs a number to deliver, and
    an unreachable parcel comes back at our cost. It was accepted blank before,
    and the payment adapter quietly substituted a placeholder so bill creation
    would not fail — which turned a missing number into a silent one.

    Malaysian mobile: 01 followed by 8 or 9 digits, spaces/dashes tolerated.
    Landlines are deliberately not accepted; couriers text the recipient.
  */
  const phoneDigits = form.phone.replace(/\D/g, "");
  if (!/^01\d{8,9}$/.test(phoneDigits)) {
    return { error: "Enter a valid Malaysian mobile number, e.g. 012 345 6789." };
  }
  if (!form.recipient.trim() || !form.line1.trim() || !form.city.trim()) {
    return { error: "Please complete the delivery address." };
  }
  if (!/^\d{5}$/.test(form.postcode.trim())) {
    return { error: "Enter a valid 5-digit postcode." };
  }
  if (!MY_STATES.has(form.state)) {
    return { error: "Please choose a state." };
  }

  // Resolve the cart to variants; refuse to proceed if anything fell out of catalog.
  const { lines, missing } = await resolveCartLines(cart);
  if (missing.length) {
    return {
      error: `${missing.map((m) => m.slug).join(", ")} is no longer available. Please remove it from your bag.`,
    };
  }

  /*
    create_order raises for conditions the shopper needs to hear about — an
    item sold out between browsing and paying, most of all. Those raises are
    written for a customer's eyes ("Ruwa Caftan (Burgundy · S/M) is sold out"),
    so surface the message rather than letting an uncaught throw become the
    generic crash page. An unrecognised error still fails safe and generic.
  */
  let order: Awaited<ReturnType<typeof createOrder>>;
  try {
    order = await createOrder({
      items: lines,
      email,
      phone: form.phone.trim() || undefined,
      address: {
        recipient: form.recipient.trim(),
        phone: form.phone.trim() || undefined,
        line1: form.line1.trim(),
        line2: form.line2.trim() || undefined,
        city: form.city.trim(),
        postcode: form.postcode.trim(),
        state: form.state,
        country: "MY",
      },
      shippingMethod: form.shippingMethod,
      discountCode: form.discountCode.trim() || undefined,
      // A request, not a price — the database clamps it against the real balance.
      redeemPoints: form.redeemPoints,
    });
  } catch (e) {
    const msg = (e as Error).message.replace(/^createOrder failed:\s*/, "");
    // The conditions create_order raises are all safe to show; anything else
    // is unexpected and gets a neutral message instead of leaking internals.
    const known = /sold out|left of|not available|cart is empty|email is required|invalid quantity/i;
    console.error("[checkout] placeOrder failed:", msg);
    return { error: known.test(msg) ? msg : "Something went wrong placing your order. Please try again." };
  }

  // Order-received email (no-op until Resend is configured).
  await sendOrderReceivedEmail(order.reference, email).catch(() => {});

  // Stash the reference for the confirmation page — httpOnly, not in the URL
  // (keeps the email out of query strings). Cleared once the order is shown.
  const jar = await cookies();
  jar.set("kalima_order", JSON.stringify({ reference: order.reference, email }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  });

  // With ANY gateway configured, go pick a method; otherwise the order sits
  // pending and we show the confirmation directly.
  redirect(configuredProviders().length ? "/checkout/pay" : "/checkout/success");
}

/*
  Step 2 (only when a gateway is configured): the shopper picked a bank/e-wallet
  on /checkout/pay. Create the LeanX bill for the order's server-side total,
  record the pending payment, and hand off to the hosted page.
*/
export async function startPayment(paymentServiceId: string): Promise<PlaceOrderState> {
  if (!paymentServiceId) return { error: "Please choose how you'd like to pay." };

  /*
    The chosen option decides the gateway. Resolved from the id rather than
    taking a provider name from the client: a caller who could name the provider
    could pair an Atome option with LeanX's adapter, and the mismatch would only
    surface as a failed bill after the shopper committed.
  */
  const provider = providerForService(paymentServiceId);
  if (!provider) return { error: "Payment is not available right now." };

  const jar = await cookies();
  const raw = jar.get("kalima_order")?.value;
  if (!raw) return { error: "Your checkout session expired. Please try again." };

  let reference: string, email: string;
  try {
    ({ reference, email } = JSON.parse(raw) as { reference: string; email: string });
  } catch {
    return { error: "Your checkout session expired. Please try again." };
  }
  const order = await getOrderForCheckout(reference, email);
  if (!order) return { error: "Order not found." };
  if (order.status !== "pending") return { error: "This order is no longer awaiting payment." };

  /*
    No localhost fallback here. In production headersOrigin() returns null when
    NEXT_PUBLIC_SITE_URL is unset, and minting a bill with a localhost — or a
    forged-Host — callback is worse than refusing: the customer would pay and
    the callback would never reach us. Fail closed and tell them to retry.
  */
  const origin = await headersOrigin();
  if (!origin) {
    console.error("[payments] no callback origin — NEXT_PUBLIC_SITE_URL unset in production");
    return { error: "Payment is temporarily unavailable. Please try again shortly." };
  }

  const isAtome = provider.name === "atome";

  /*
    Atome takes OUR reference as its payment id (its create call is idempotent on
    it), so the per-attempt reference is computed here and passed through the
    paymentServiceId slot — which for Atome is the reference, not a bank id.
    LeanX generates its own bill_no and takes the shopper's chosen bank instead.
  */
  const serviceOrReference = isAtome
    ? buildAtomeReference(order.reference, await countPaymentAttempts(order.id, "atome"))
    : paymentServiceId;

  let session;
  try {
    session = await provider.createCheckout({
      reference: order.reference,
      amountSen: order.total_sen, // server-side total, never the client's
      fullName: order.shipping_address?.recipient ?? "Customer",
      email: order.email,
      phone: order.phone ?? "",
      paymentServiceId: serviceOrReference,
      returnUrl: `${origin}/checkout/success`,
      // Atome distinguishes abandonment from success; send them back to pick again.
      cancelUrl: `${origin}/checkout/pay`,
      callbackUrl: isAtome
        ? `${origin}/api/payments/atome/webhook`
        : `${origin}/api/payments/webhook`,
    });
  } catch (e) {
    /*
      Show the gateway's own reason rather than a generic failure. Atome's
      documented rejections — an amount outside this merchant's limits, an
      unreachable callback — are configuration problems, and a shopper staring at
      "something went wrong" gives the operator nothing to go on.
    */
    console.error(`[payments] ${provider.name} createCheckout failed for ${order.reference}:`, e);
    const detail = e instanceof Error ? e.message : "";
    return {
      error: detail.startsWith("Atome requires")
        ? detail
        : "That payment method could not be started. Please try another.",
    };
  }

  await recordPendingPayment(order.id, provider.name, session.providerRef, order.total_sen);
  redirect(session.redirectUrl);
}

/*
  The origin LeanX is told to call back on.

  NEXT_PUBLIC_SITE_URL wins when set, and in production it must be: the request
  host is whatever URL the shopper happened to arrive on. On a Vercel
  deployment-specific URL behind Deployment Protection, a callback addressed
  there meets the SSO wall — the gateway's POST never reaches us and nothing
  appears in the logs. No rejection, no request, silence, and a paid order that
  stays pending. Guide §0.6.
*/
async function headersOrigin(): Promise<string | null> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;

  /*
    In production the origin must be configured, not sniffed from the request.
    x-forwarded-host and host are attacker-controllable, and this value becomes
    the gateway callback and redirect URLs — a forged Host header would send a
    bill's callback to someone else's server. Falling back to the request host
    is a dev-only convenience; refuse it once deployed rather than mint a bill
    pointing somewhere unverifiable.
  */
  if (process.env.NODE_ENV === "production") return null;

  const { headers } = await import("next/headers");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
