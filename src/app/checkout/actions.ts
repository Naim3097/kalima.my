"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createOrder,
  resolveCartLines,
  validateDiscount,
  getOrderForCheckout,
  recordPendingPayment,
  type CartRef,
  type DiscountResult,
} from "@/lib/commerce";
import { getPaymentProvider } from "@/lib/payments";
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

  const order = await createOrder({
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

  // Order-received email (no-op until Resend is configured).
  await sendOrderReceivedEmail(order.reference, email).catch(() => {});

  // Stash the reference for the confirmation page — httpOnly, not in the URL
  // (keeps the email out of query strings). Cleared once the order is shown.
  const jar = await cookies();
  jar.set("kalima_order", JSON.stringify({ reference: order.reference, email }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  });

  // With a gateway configured, go pick a bank/e-wallet; otherwise the order
  // sits pending and we show the confirmation directly.
  redirect(getPaymentProvider() ? "/checkout/pay" : "/checkout/success");
}

/*
  Step 2 (only when a gateway is configured): the shopper picked a bank/e-wallet
  on /checkout/pay. Create the LeanX bill for the order's server-side total,
  record the pending payment, and hand off to the hosted page.
*/
export async function startPayment(paymentServiceId: string): Promise<PlaceOrderState> {
  const provider = getPaymentProvider();
  if (!provider) return { error: "Payment is not available right now." };
  if (!paymentServiceId) return { error: "Please choose how you'd like to pay." };

  const jar = await cookies();
  const raw = jar.get("kalima_order")?.value;
  if (!raw) return { error: "Your checkout session expired. Please try again." };

  const { reference, email } = JSON.parse(raw) as { reference: string; email: string };
  const order = await getOrderForCheckout(reference, email);
  if (!order) return { error: "Order not found." };
  if (order.status !== "pending") return { error: "This order is no longer awaiting payment." };

  const origin = (await headersOrigin()) || "http://localhost:3000";

  const session = await provider.createCheckout({
    reference: order.reference,
    amountSen: order.total_sen, // server-side total, never the client's
    fullName: order.shipping_address?.recipient ?? "Customer",
    email: order.email,
    phone: order.phone ?? "",
    paymentServiceId,
    returnUrl: `${origin}/checkout/success`,
    callbackUrl: `${origin}/api/payments/webhook`,
  });

  await recordPendingPayment(order.id, session.providerRef, order.total_sen);
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

  const { headers } = await import("next/headers");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
