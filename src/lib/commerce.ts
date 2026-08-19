import "server-only";

import { cookies } from "next/headers";

import { createAdminClient, createClient } from "@/lib/supabase/server";

/*
  Commerce data access. The order functions are service_role-only in Postgres,
  so everything here runs through the admin client and MUST stay server-side.
  Price/discount/shipping are computed inside the DB functions — never trust
  amounts from the browser.
*/

export type CartLine = { variant_id: string; qty: number };

/** A cart line as the client stores it — resolved to a variant id below. */
export type CartRef = { slug: string; color: string; size: string; qty: number };

/*
  Resolves cart lines (product slug + colour name + size, as the client stores
  them) to product_variant ids for create_order. Runs server-side with the
  admin client. Any line that no longer maps to a published variant is returned
  in `missing` so checkout can tell the shopper rather than silently dropping it.
*/
export async function resolveCartLines(
  refs: CartRef[],
): Promise<{ lines: CartLine[]; missing: CartRef[]; subtotalSen: number }> {
  const supabase = admin();
  const lines: CartLine[] = [];
  const missing: CartRef[] = [];
  let subtotalSen = 0;

  for (const ref of refs) {
    const { data, error } = await supabase
      .from("product_variants")
      .select("id, price_sen, products!inner(slug, published, price_sen, sale_price_sen)")
      .eq("products.slug", ref.slug)
      .eq("products.published", true)
      .eq("color_name", ref.color)
      .eq("size", ref.size)
      .maybeSingle();

    if (error) throw new Error(`resolveCartLines failed: ${error.message}`);
    if (!data) {
      missing.push(ref);
      continue;
    }
    /*
      Variant override, else the product's sale price, else its list price —
      the same coalesce create_order uses. This subtotal is only ever a preview
      (shipping estimate, discount validation); create_order re-derives it.
    */
    const product = data.products as unknown as { price_sen: number; sale_price_sen: number | null };
    const unit = data.price_sen ?? product.sale_price_sen ?? product.price_sen;
    subtotalSen += unit * ref.qty;
    lines.push({ variant_id: data.id, qty: ref.qty });
  }

  return { lines, missing, subtotalSen };
}

export type OrderAddress = {
  recipient: string;
  phone?: string;
  line1: string;
  line2?: string;
  city: string;
  postcode: string;
  state: string;
  country?: string;
};

export type DiscountResult = {
  valid: boolean;
  code?: string;
  kind?: "percent" | "fixed" | "free_shipping";
  discount_sen: number;
  free_shipping?: boolean;
  reason?: string;
};

export type CreateOrderResult = {
  order_id: string;
  reference: string;
  total_sen: number;
  loyalty_points_used?: number;
  loyalty_discount_sen?: number;
};

export type OrderView = {
  reference: string;
  status: string;
  email: string;
  subtotal_sen: number;
  discount_sen: number;
  shipping_sen: number;
  total_sen: number;
  shipping_address: OrderAddress | null;
  created_at: string;
  items: {
    product_name: string;
    color_name: string;
    size: string;
    qty: number;
    line_total_sen: number;
  }[];
};

function admin() {
  const client = createAdminClient();
  if (!client) {
    // Phase 2 needs the service-role key; fail loud rather than half-work.
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — order operations require it.",
    );
  }
  return client;
}

/** Live discount validation against a server-computed subtotal (in sen). */
export async function validateDiscount(
  code: string,
  subtotalSen: number,
): Promise<DiscountResult> {
  const { data, error } = await admin().rpc("validate_discount", {
    p_code: code,
    p_subtotal_sen: subtotalSen,
  });
  if (error) throw new Error(`validateDiscount failed: ${error.message}`);
  return data as DiscountResult;
}

/*
  Creates a pending order. `userId` is the *verified* session user (or null for
  guests) — resolved here from the auth cookie, never taken from the caller's
  input, so a guest can't spoof someone else's account onto an order.
*/
/*
  What this cart costs, before anything is placed.

  Calls the SAME price_order() the charge does, so the summary a shopper agrees
  to is arithmetic from the identical source — not a second implementation that
  merely agrees today. Everything that used to be recomputed in the checkout
  component (the code, the new-member discount, the loyalty clamp, the shipping
  threshold, the no-stacking rule) is now a field on this result.

  Service role, like every order function, and the user id comes from the
  session at the call site — never from the browser.
*/
export type ShippingZone = "west" | "east" | "overseas";

export type OrderQuote = {
  subtotalSen: number;
  discountSen: number;
  discountCode: string | null;
  firstOrderDiscountSen: number;
  loyaltyPointsUsed: number;
  loyaltyDiscountSen: number;
  shippingSen: number;
  freeShipping: boolean;
  zone: ShippingZone;
  /* Copied from the frozen quote, so the summary names the courier that was
     quoted rather than one the caller asked for. Null for Malaysian orders. */
  shippingServiceName: string | null;
  shippingCourier: string | null;
  /* True when the destination is overseas and no courier has been chosen yet.
     `shippingSen` is 0 in that state — it means "not known", never "free", and
     an order must not be placed until it is resolved. */
  requiresShippingSelection: boolean;
  taxSen: number;
  totalSen: number;
};

export async function quoteOrder(params: {
  userId: string | null;
  items: CartLine[];
  discountCode?: string;
  redeemPoints?: number;
  /* Where it is going. Shipping is a zone rate for Malaysia and the chosen
     courier's price for anywhere else, so a quote without a destination is a
     quote for the wrong thing. Defaults to Malaysia, matching the form. */
  country?: string;
  state?: string | null;
  /*
    The server-issued quote and the service chosen from it. NOT a price — the
    amount is read from shipping_quotes inside price_order, so nothing between
    the browser and the database can name what shipping costs.
  */
  quoteId?: string | null;
  serviceId?: string | null;
}): Promise<OrderQuote> {
  const { data, error } = await admin().rpc("price_order", {
    p_user_id: params.userId,
    p_items: params.items,
    p_discount_code: params.discountCode ?? null,
    p_redeem_points: params.redeemPoints ?? 0,
    p_country: params.country ?? "MY",
    p_state: params.state ?? null,
    p_quote_id: params.quoteId ?? null,
    p_service_id: params.serviceId ?? null,
  });
  if (error) throw new Error(`quoteOrder failed: ${error.message}`);

  const q = data as Record<string, unknown>;
  return {
    subtotalSen: Number(q.subtotal_sen ?? 0),
    discountSen: Number(q.discount_sen ?? 0),
    discountCode: (q.discount_code as string | null) ?? null,
    firstOrderDiscountSen: Number(q.first_order_discount_sen ?? 0),
    loyaltyPointsUsed: Number(q.loyalty_points_used ?? 0),
    loyaltyDiscountSen: Number(q.loyalty_discount_sen ?? 0),
    shippingSen: Number(q.shipping_sen ?? 0),
    freeShipping: Boolean(q.free_shipping),
    zone: (q.shipping_zone as ShippingZone) ?? "west",
    shippingServiceName: (q.shipping_service_name as string | null) ?? null,
    shippingCourier: (q.shipping_courier as string | null) ?? null,
    requiresShippingSelection: Boolean(q.requires_shipping_selection),
    taxSen: Number(q.tax_sen ?? 0),
    totalSen: Number(q.total_sen ?? 0),
  };
}

/*
  Closes out the customer's abandoned checkouts before a new one is placed.

  Two reasons, and the second is the one that costs money. An abandoned pending
  order clutters the order list — but it also HOLDS the new-member discount,
  because price_order refuses to grant it twice while another order still
  carries it. Without this sweep, abandoning a checkout once would silently
  withdraw the offer until the nightly expiry ran.

  Only genuinely dead attempts are cancelled. findLivePaymentAttempt is the same
  check startPayment uses to decide whether to resume a bill: an order whose
  gateway still says "in progress" is left exactly where it is, because the
  customer may be on that hosted page right now.
*/
export async function cancelAbandonedPendingOrders(userId: string): Promise<number> {
  const { data: pending, error } = await admin()
    .from("orders")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "pending");
  if (error || !pending?.length) return 0;

  let cancelled = 0;
  for (const order of pending) {
    const attempt = await findLivePaymentAttempt(order.id);
    if (attempt.verdict !== "dead") continue;

    const { error: cancelError } = await admin().rpc("cancel_pending_order", {
      p_order_id: order.id,
      p_reason: "superseded by a new checkout",
    });
    if (!cancelError) cancelled++;
  }
  return cancelled;
}

export async function createOrder(params: {
  items: CartLine[];
  email: string;
  phone?: string;
  address: OrderAddress;
  shippingMethod: string;
  discountCode?: string;
  /*
    Points the shopper asked to spend. Only a REQUEST — create_order clamps it
    against their real balance and the scheme's limits, and computes what it is
    worth. Nothing here decides a price.
  */
  redeemPoints?: number;
  /*
    The server-issued quote and the service chosen from it.

    Malaysia never sets these — its price is a zone rate the database already
    knows. Overseas REQUIRES them: create_order refuses the order otherwise
    rather than shipping a parcel for nothing, because "no service chosen" and
    "free" must never be the same value. Neither is a price; the amount lives
    in shipping_quotes and is read there.
  */
  quoteId?: string | null;
  serviceId?: string | null;
}): Promise<CreateOrderResult> {
  const auth = await createClient();
  const userId = auth ? (await auth.auth.getUser()).data.user?.id ?? null : null;

  const { data, error } = await admin().rpc("create_order", {
    p_user_id: userId,
    p_items: params.items,
    p_email: params.email,
    p_phone: params.phone ?? null,
    /* The destination is read from this snapshot inside create_order, so the
       address that prices the order is the address stored on it. */
    p_address: params.address,
    p_shipping_method: params.shippingMethod,
    p_discount_code: params.discountCode ?? null,
    p_redeem_points: Math.max(0, Math.trunc(params.redeemPoints ?? 0)),
    p_quote_id: params.quoteId ?? null,
    p_service_id: params.serviceId ?? null,
  });
  if (error) throw new Error(`createOrder failed: ${error.message}`);
  const result = data as CreateOrderResult;

  /*
    Stamp the affiliate referral slug from the ?ref cookie the proxy set.

    Done as a follow-up update rather than a create_order parameter so the money
    function's signature stays untouched — attribution is bookkeeping layered on
    top of the sale, and must never be able to fail the sale itself.
  */
  try {
    const jar = await cookies();
    const ref = jar.get("kalima_ref")?.value;
    if (ref) {
      await admin().from("orders").update({ affiliate_ref: ref }).eq("id", result.order_id);
    }
  } catch {
    // An unattributed order is a bookkeeping loss, not a failed checkout.
  }

  return result;
}

/** Guest-safe order lookup for the confirmation page (email must match). */
export async function getOrderByReference(
  reference: string,
  email: string,
): Promise<OrderView | null> {
  const { data, error } = await admin().rpc("get_order_by_reference", {
    p_reference: reference,
    p_email: email,
  });
  if (error) throw new Error(`getOrderByReference failed: ${error.message}`);
  return (data as OrderView | null) ?? null;
}

/*
  Confirms payment: idempotent, oversell-guarded, decrements stock. Called ONLY
  from the payment webhook AFTER the gateway signature has been verified — never
  from a browser redirect. LeanX-specific parsing lands when the .md arrives.
*/
export async function markOrderPaid(params: {
  orderId: string;
  provider: string;
  /* null when the gateway gave no bill number — never "", which is not null
     and so would collide under the (provider, provider_ref) unique index. */
  providerRef: string | null;
  amountSen: number;
  raw?: unknown;
}): Promise<{ status: string; reference: string }> {
  const { data, error } = await admin().rpc("mark_order_paid", {
    p_order_id: params.orderId,
    p_provider: params.provider,
    p_provider_ref: params.providerRef,
    p_amount_sen: params.amountSen,
    p_raw: params.raw ?? null,
  });
  if (error) throw new Error(`markOrderPaid failed: ${error.message}`);
  return data as { status: string; reference: string };
}

/*
  Records affiliate commission for an order that has just become paid.

  Called after markOrderPaid, never at checkout — an abandoned or failed order
  must not earn anyone a commission. The underlying function is idempotent and
  carries the fraud guards (self-purchase, one-per-order, approved-only), so a
  retried webhook is harmless.
*/
export async function attributeReferral(orderId: string): Promise<void> {
  const { error } = await admin().rpc("attribute_referral", { p_order_id: orderId });
  // Commission bookkeeping must never break a payment confirmation.
  if (error) console.error("attributeReferral failed:", error.message);
}

/*
  Applies a gateway-initiated refund (the merchant refunded in the LeanX
  dashboard and LeanX pushed a `refunded` webhook). Returns the goods to stock
  through the ledger and flips the order, exactly as the admin action does.

  Idempotent at the database level, so LeanX's retries are harmless.
*/
export async function refundOrderFromWebhook(params: {
  orderId: string;
  amountSen: number;
  reason?: string;
}): Promise<{ status: string; reference: string }> {
  const { data, error } = await admin().rpc("refund_order", {
    p_order_id: params.orderId,
    p_amount_sen: params.amountSen,
    p_restock: true,
    p_reason: params.reason ?? "gateway refund",
  });
  if (error) throw new Error(`refundOrderFromWebhook failed: ${error.message}`);
  return data as { status: string; reference: string };
}

/*
  The order fields the payment step needs, gated by matching email (guest-safe).
  Returns null unless the order exists and belongs to that email.

  This runs on the admin client, which bypasses RLS, so the email match IS the
  authorization — there is no session behind a guest checkout. It must be an
  exact, case-insensitive equality, never a pattern match: the email arrives
  from the kalima_order cookie, and a cookie is just a request header an
  attacker sets freely. With `ilike`, a value of "%" matched every order, and
  since references are a public sequential sequence, that turned the pay page
  into an order-book enumerator (and let an attacker mint a live bill against
  someone else's pending order). `eq` on lower()'d values takes the pattern
  metacharacters out of play entirely.
*/
/*
  What the payment step needs to know about an order.

  Carries the money breakdown and the lines, not just the total, because Atome
  itemises: it rejects create-payment without per-item detail, and items without
  the shipping and tax parts cannot be reconciled against the total on an order
  that carried a discount. LeanX uses only `total_sen` and ignores the rest.
*/
export type CheckoutOrder = {
  id: string;
  reference: string;
  email: string;
  phone: string | null;
  total_sen: number;
  subtotal_sen: number;
  shipping_sen: number;
  tax_sen: number;
  status: string;
  shipping_address: OrderAddress | null;
  items: {
    product_name: string;
    variant_sku: string;
    color_name: string;
    size: string;
    qty: number;
    unit_price_sen: number;
  }[];
};

export async function getOrderForCheckout(
  reference: string,
  email: string,
): Promise<CheckoutOrder | null> {
  const wanted = email.trim().toLowerCase();
  if (!wanted) return null;

  const { data, error } = await admin()
    .from("orders")
    .select(
      `id, reference, email, phone, total_sen, subtotal_sen, shipping_sen, tax_sen, status, shipping_address,
       order_items ( product_name, variant_sku, color_name, size, qty, unit_price_sen )`,
    )
    .eq("reference", reference)
    .maybeSingle();
  if (error) throw new Error(`getOrderForCheckout failed: ${error.message}`);
  if (!data) return null;

  // Compare in the app, so no attacker-supplied pattern ever reaches the query.
  if (data.email.trim().toLowerCase() !== wanted) return null;

  /* The embed comes back as `order_items`; flatten it to `items` so callers see
     the shape OrderView already uses rather than the query's. */
  const { order_items, ...order } = data as Omit<CheckoutOrder, "items"> & {
    order_items: CheckoutOrder["items"] | null;
  };
  return { ...order, items: order_items ?? [] };
}

/*
  Records the pending payment attempt at bill creation (guide §4). The webhook
  later upserts this row to paid via mark_order_paid, keyed on (provider,
  provider_ref) — so the bill_no is the idempotency anchor.
*/
export async function recordPendingPayment(
  orderId: string,
  provider: string,
  providerRef: string,
  amountSen: number,
  /* Where this attempt sent the shopper, so it can be RESUMED rather than
     duplicated. See findLivePaymentAttempt. */
  redirectUrl?: string,
): Promise<void> {
  const { error } = await admin().from("payments").insert({
    order_id: orderId,
    /* Passed in, not hardcoded: this used to be the literal "leanx", which
       would have filed every Atome attempt under the wrong gateway and made
       the (provider, provider_ref) index meaningless across providers. */
    provider,
    provider_ref: providerRef,
    status: "pending",
    amount_sen: amountSen,
    ...(redirectUrl ? { redirect_url: redirectUrl } : {}),
  });
  if (error) throw new Error(`recordPendingPayment failed: ${error.message}`);
}

/*
  Is there already a payment attempt on this order that the shopper could still
  complete?

  THE POINT IS TO NOT MINT A SECOND BILL. Nothing stops a shopper reaching the
  picker twice — "Try payment again" on the success page is a link straight to
  it, and the back button works just as well. Each pass used to create a fresh
  hosted bill, and both stayed payable: the first to be paid settles the order,
  the second arrives at a settled order, gets `already_paid` and leaves the
  customer charged twice for one thing.

  Verdicts, and why each is what it is:

    "paid"  the gateway says this attempt succeeded. The caller must send the
            shopper to the confirmation, never to another payment page — this
            is the case where a second bill costs real money.
    "live"  still completable. Resume it: `redirectUrl` is the page they were
            already on. Also returned when the lookup fails INSIDE the
            provider's payable window, for the same reason the expiry sweep
            holds there — an unreadable answer is not permission to charge
            again.
    "dead"  failed, cancelled, or past the window with nothing to show for it.
            A new attempt is correct.

  Deliberately reads the LATEST attempt only. An older one is either dead or
  already resumed into this one, and asking the gateway about every historical
  bill would add a round trip per retry to the slowest path in checkout.
*/
export async function findLivePaymentAttempt(
  orderId: string,
): Promise<{ verdict: "paid" | "live" | "dead"; redirectUrl: string | null; provider: string | null }> {
  const { providerByName } = await import("@/lib/payments");

  const { data: attempt } = await admin()
    .from("payments")
    .select("provider, provider_ref, status, redirect_url, created_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!attempt?.provider_ref) return { verdict: "dead", redirectUrl: null, provider: null };

  const redirectUrl = (attempt.redirect_url as string | null) ?? null;
  const providerName = attempt.provider as string;
  const provider = providerByName(providerName);
  /*
    A gateway we can no longer ask — its credentials were removed. Treat the
    attempt as live rather than dead: we cannot prove it is unpayable, and the
    cost of being wrong is a double charge.
  */
  if (!provider) return { verdict: "live", redirectUrl, provider: providerName };

  const verdict = await provider.checkStatus(attempt.provider_ref as string);

  if (verdict.status === "completed") {
    return { verdict: "paid", redirectUrl, provider: providerName };
  }
  if (verdict.status === "failed" || verdict.status === "cancelled") {
    return { verdict: "dead", redirectUrl, provider: providerName };
  }
  if (verdict.status === "processing") {
    return { verdict: "live", redirectUrl, provider: providerName };
  }

  // "unknown" — same clock rule reconcileOrderPayment applies.
  const startedAt = Date.parse(String(attempt.created_at ?? ""));
  const ageMinutes = Number.isFinite(startedAt) ? (Date.now() - startedAt) / 60_000 : Infinity;
  return {
    verdict: ageMinutes < provider.payableWindowMinutes ? "live" : "dead",
    redirectUrl,
    provider: providerName,
  };
}

/*
  How many payment attempts a provider already has on an order.

  Atome needs this: its create-payment is idempotent on referenceId and it
  cancels unpaid payments after 12 hours, so attempt N must carry a distinct
  reference or it resurrects a cancelled record. See buildAtomeReference.
*/
export async function countPaymentAttempts(orderId: string, provider: string): Promise<number> {
  const { count, error } = await admin()
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
    .eq("provider", provider);
  if (error) throw new Error(`countPaymentAttempts failed: ${error.message}`);
  return count ?? 0;
}

/*
  Asks the gateway what happened to an order's bill, and settles it if the
  answer is definite.

  Needed because LeanX pushes a callback on SUCCESS ONLY — a cancelled or
  failed bill is never announced. Without this an abandoned checkout sits
  `pending` forever and the buyer is told their order "has been received".

  Returns the verdict, and only ever moves an order on an explicit one:
  "unknown" (a flaky lookup, a 404 for a bill that exists) leaves it alone.
  Settlement goes through mark_order_paid, so this shares the webhook's
  idempotency and its amount check rather than inventing a second way to pay.
*/
export async function reconcileOrderPayment(
  reference: string,
): Promise<"paid" | "failed" | "pending" | "live"> {
  const { providerByName } = await import("@/lib/payments");

  const { data: order } = await admin()
    .from("orders")
    .select("id")
    .eq("reference", reference)
    .maybeSingle();
  const orderId = order?.id as string | undefined;
  if (!orderId) return "pending";

  /*
    THE PAYMENT ROW DECIDES WHICH GATEWAY TO ASK, not the configured default.

    This used to select the default provider first and then filter payments by
    its name, which was correct only while LeanX was the sole gateway. With Atome
    added, an Atome order would have matched no payment row and reported
    "pending" forever — and had the default ever been Atome, a LeanX bill number
    would have been sent to Atome's status endpoint.
  */
  const { data: payment } = await admin()
    .from("payments")
    .select("provider, provider_ref, amount_sen, created_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const billNo = payment?.provider_ref as string | undefined;
  if (!billNo) return "pending";

  /*
    "live", not "pending": a payment EXISTS at a gateway we can no longer query
    (its credentials were removed). We cannot know whether it is still payable,
    and cancelling an order that turns out to be paid is far worse than leaving
    one open, so hold it. The sweep reports these so they are visible rather
    than quietly accumulating.
  */
  const provider = providerByName(String(payment?.provider ?? ""));
  if (!provider) return "live";

  const verdict = await provider.checkStatus(billNo);

  if (verdict.status === "completed") {
    // The gateway's amount must still match ours — same rule as the webhook.
    if (
      typeof verdict.amountSen === "number" &&
      typeof payment?.amount_sen === "number" &&
      verdict.amountSen !== payment.amount_sen
    ) {
      /*
        The gateway says PAID and the figures disagree. This used to return
        "pending", which the expiry sweep reads as "cancel it" — so the one case
        where the customer has definitely been charged was also the case that
        closed their order. "live" holds it for a human instead.
      */
      console.error(
        `[payments] AMOUNT MISMATCH on ${reference} via ${provider.name}: gateway says ${verdict.amountSen}, we recorded ${payment.amount_sen}. Order held, needs manual review.`,
      );
      return "live";
    }
    const outcome = await markOrderPaid({
      orderId,
      provider: provider.name,
      providerRef: billNo,
      amountSen: verdict.amountSen ?? (payment?.amount_sen as number),
      raw: verdict.raw,
    });

    /*
      Only on the transition. "already_paid" means the webhook got here first
      and has already sent everything — see runPaidSideEffects.
    */
    if (outcome.status === "paid") {
      const { data: full } = await admin()
        .from("orders")
        .select("id, reference, email")
        .eq("id", orderId)
        .maybeSingle();
      if (full) {
        await runPaidSideEffects(full as { id: string; reference: string; email: string });
      }
    }
    return "paid";
  }

  if (verdict.status === "failed" || verdict.status === "cancelled") return "failed";

  /*
    PROCESSING means the gateway is still willing to take this payment, so the
    order must NOT be cancelled — this is the Atome case that made the
    distinction necessary. An Atome payment stays payable for TWELVE HOURS while
    the expiry sweep runs at thirty minutes, so folding "processing" in with
    "nothing found" cancelled orders that a customer could still complete. They
    would then be charged against a closed order: mark_order_paid raises, the
    webhook logs "settlement held for review", and the money is real.

    LeanX never exposed this because an FPX bill dies in minutes.
  */
  if (verdict.status === "processing") return "live";

  /*
    "unknown" — the lookup told us nothing. A 404 for a bill that genuinely
    exists, a 5xx, a timeout, or a reference the gateway has not committed yet
    all land here, and none of them can be told apart from "there was never a
    payment".

    SO THE CLOCK DECIDES, NOT THE FAILURE. Cancellable only once the attempt is
    older than the window in which this gateway would still take the money.
    Inside that window we hold, because the shopper may be looking at a payment
    page that still works — and cancelling then charges them against a closed
    order, which is the exact failure the processing case above exists to
    prevent. It was reachable here too: this branch read "an FPX bill is not
    payable hours later" and applied that to Atome, whose payments live for
    twelve hours.

    Past the window, cancelling is right and necessary: LeanX's status endpoint
    404s for real bills, so holding forever would mean abandoned FPX orders that
    never expire at all.
  */
  const startedAt = Date.parse(String(payment?.created_at ?? ""));
  const ageMinutes = Number.isFinite(startedAt) ? (Date.now() - startedAt) / 60_000 : Infinity;
  if (ageMinutes < provider.payableWindowMinutes) return "live";

  return "pending";
}

/*
  Everything that must happen exactly once when an order BECOMES paid, in one
  place because there are two callers.

  settlePaymentWebhook is the front door. reconcileOrderPayment is the other
  one — it settles an order whose callback was lost, from the return page and
  from the expiry sweep — and it used to call markOrderPaid and stop there. So
  an order rescued by reconcile got no customer receipt, no notification to the
  shop, and no affiliate commission, silently. Lose LEANX_WEBHOOK_SECRET and
  EVERY order settles down that path: money in, nobody told.

  This is the fifth time this project has split one money path across two call
  sites; the note at the top of settle.ts lists the previous four. Callers must
  invoke this on the paid transition ONLY — markOrderPaid reporting
  "already_paid" means someone else has already sent these.
*/
export async function runPaidSideEffects(order: {
  id: string;
  reference: string;
  email: string;
}): Promise<void> {
  const { sendPaymentConfirmedEmail, sendNewOrderNotification } = await import("@/lib/email");
  // Never let a mail failure undo a settlement — the money is already in.
  await sendPaymentConfirmedEmail(order.reference, order.email).catch(() => {});
  await sendNewOrderNotification(order.reference, order.email).catch(() => {});
  await attributeReferral(order.id).catch(() => {});

  /*
    Meta's Purchase event, and the ONLY place it fires.

    It belongs here for the same reason everything else in this function does —
    this is the paid transition, it happens once, and markOrderPaid's
    idempotence means a redelivered webhook will not run it again. That single
    chance is why the send writes its payload down before attempting it; see
    src/lib/meta/dead-letter.ts.

    It reads the order rather than taking anything from this function's callers,
    because those callers do NOT share a request context: one is a gateway
    webhook, one is the shopper's own browser hitting the return page, one is a
    cron. See the note at the top of src/lib/meta/orders.ts.
  */
  const { sendPurchase } = await import("@/lib/meta/orders");
  await sendPurchase(order.id).catch(() => {});
}

/*
  Shouts when a settled order receives a payment it did not expect.

  Called on the NON-transition — mark_order_paid said "already_paid". Most of
  those are a gateway redelivering the same callback, which is ordinary and must
  stay silent. What must not stay silent is a DIFFERENT provider_ref arriving:
  that is a second real payment attempt on an order somebody has already paid
  for, and it means a customer has been charged twice with nothing in the logs.

  Read-only and best-effort. Deciding what to do about the money is a person's
  job — this exists so the person finds out at all.
*/
export async function flagDuplicatePayment(
  order: { id: string; reference: string },
  providerName: string,
  providerRef: string | undefined,
): Promise<void> {
  if (!providerRef) return;
  try {
    const { data } = await admin()
      .from("payments")
      .select("provider, provider_ref, status, amount_sen")
      .eq("order_id", order.id);

    const others = (data ?? []).filter(
      (p) => (p.provider_ref as string | null) && p.provider_ref !== providerRef,
    );
    if (!others.length) return;

    console.error(
      `[payments] DOUBLE PAYMENT on ${order.reference}: ${providerName}/${providerRef} settled an order that already has ` +
        `${others.map((p) => `${p.provider}/${p.provider_ref} (${p.status})`).join(", ")}. ` +
        `The customer may have been charged twice — needs manual review and possibly a refund.`,
    );
  } catch {
    /* Never let the alerting path fail the webhook — the money is already in. */
  }
}

/*
  Sweep stale pending orders. For each order older than the cutoff we ask the
  gateway one last time — because a callback can be lost, and a customer who
  genuinely paid must be settled, never cancelled. Only an order the gateway
  does NOT report as paid is cancelled.

  THE CUTOFF IS NO LONGER THE ONLY GUARD, and it was never sufficient. It used
  to be sized to "comfortably exceed the gateway's bill lifetime", which was true
  of LeanX at thirty minutes and false the moment Atome arrived: its payments
  stay payable for twelve hours. So the gateway's own verdict now decides —
  reconcileOrderPayment returns "live" while a payment can still be completed,
  and those are held rather than cancelled, whatever the cutoff says.

  reconcileOrderPayment does the gateway pull and the settle-if-paid; this adds
  only the cancel for orders it reports as failed or unfindable.

  Returns a small report for the cron log. Never throws for a single bad order —
  one stuck row must not stop the sweep.
*/
export async function expireStalePendingOrders(
  olderThanMinutes = 30,
): Promise<{
  scanned: number;
  settled: number;
  cancelled: number;
  /** Left pending because the gateway may still accept the payment. */
  held: number;
  skipped: number;
}> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();

  const { data: stale, error } = await admin()
    .from("orders")
    .select("id, reference")
    .eq("status", "pending")
    .lt("created_at", cutoff)
    .limit(200);
  if (error) throw new Error(`expireStalePendingOrders scan failed: ${error.message}`);

  let settled = 0,
    cancelled = 0,
    held = 0,
    skipped = 0;

  for (const o of stale ?? []) {
    try {
      // Ask the gateway first; this settles the order if the callback was lost.
      const verdict = await reconcileOrderPayment(o.reference);
      if (verdict === "paid") {
        settled += 1;
        continue;
      }
      /*
        NEVER CANCEL A PAYMENT THE GATEWAY WILL STILL ACCEPT.

        "live" means the gateway reports the payment as still in progress — or
        that we could not ask it at all. Cancelling then leaves the customer able
        to complete a payment against a closed order, which charges them for
        something we will refuse to fulfil.

        Atome is why this exists: its payments stay payable for twelve hours
        while this sweep runs at thirty minutes. Holding costs nothing — a
        pending order reserves no stock — and the next sweep asks again, so a
        genuinely abandoned payment is cancelled once the gateway says so.
      */
      if (verdict === "live") {
        held += 1;
        continue;
      }
      // "failed", or nothing findable at any gateway → cancel it.
      await admin().rpc("cancel_pending_order", {
        p_order_id: o.id,
        p_reason: `unpaid after ${olderThanMinutes} minutes`,
      });
      cancelled += 1;
    } catch (e) {
      // One order's problem is not the sweep's problem.
      console.error(`[expire] ${o.reference} skipped:`, (e as Error).message);
      skipped += 1;
    }
  }

  /* `held` is reported, not swallowed: an order held every run means a gateway
     payment nobody is completing, and that should be visible in the cron output
     rather than looking like a sweep that found nothing to do. */
  return { scanned: stale?.length ?? 0, settled, cancelled, held, skipped };
}

/*
  Resolves a webhook's bill_no back to its order (primary match). Falls back to
  the invoice_ref (order reference) when no pending payment row is found.
*/
export async function resolveWebhookOrder(
  providerRef: string | undefined,
  orderReference: string | undefined,
  /*
    WHOSE reference this is. It used to be hardcoded to "leanx", which was
    invisible while LeanX was the only gateway and wrong the moment Atome
    arrived: Atome's rows are written with provider "atome", so the primary
    lookup could never match one and every Atome settlement fell through to the
    order-reference fallback. Worse, an Atome reference was being matched
    against LeanX's provider_ref namespace, which is not the same space.

    Optional so a caller that genuinely does not know still gets the fallback
    rather than a compile error.
  */
  providerName?: string,
): Promise<{ id: string; total_sen: number; email: string; reference: string } | null> {
  const supabase = admin();

  if (providerRef) {
    let q = supabase
      .from("payments")
      .select("order_id, orders(id, total_sen, email, reference)")
      .eq("provider_ref", providerRef);
    if (providerName) q = q.eq("provider", providerName);
    const { data } = await q.maybeSingle();
    const order = data?.orders as unknown as
      | { id: string; total_sen: number; email: string; reference: string }
      | null;
    if (order) return order;
  }

  if (orderReference) {
    const { data } = await supabase
      .from("orders")
      .select("id, total_sen, email, reference")
      .eq("reference", orderReference)
      .maybeSingle();
    if (data) return data;
  }

  return null;
}

/** A signed-in customer's own orders, for the account order history. */
export async function fetchMyOrders(): Promise<
  {
    reference: string;
    status: string;
    total_sen: number;
    created_at: string;
    items: { product_name: string; color_name: string; size: string; qty: number }[];
    shipments: { courier: string | null; tracking_no: string | null; tracking_url: string | null; status: string }[];
  }[]
> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("orders")
    .select(
      "reference, status, total_sen, created_at, order_items(product_name, color_name, size, qty), shipments(courier, tracking_no, tracking_url, status)",
    )
    .order("created_at", { ascending: false });

  if (error) throw new Error(`fetchMyOrders failed: ${error.message}`);
  return (data ?? []).map((o) => ({
    reference: o.reference,
    status: o.status,
    total_sen: o.total_sen,
    created_at: o.created_at,
    items: (o.order_items ?? []) as {
      product_name: string;
      color_name: string;
      size: string;
      qty: number;
    }[],
    shipments: (o.shipments ?? []) as {
      courier: string | null;
      tracking_no: string | null;
      tracking_url: string | null;
      status: string;
    }[],
  }));
}

/*
  Awards Kalima Club points for a completed order.

  Called when an order reaches 'completed' — the shipping webhook on delivery,
  or a manual status change. Earning on completion rather than payment means
  points for goods still inside the return window are never handed out and then
  clawed back. Idempotent at the database level, so a replayed delivery push is
  harmless.
*/
export async function awardLoyaltyPoints(orderId: string): Promise<void> {
  const { error } = await admin().rpc("award_loyalty_points", { p_order_id: orderId });
  // Loyalty is bookkeeping on top of the sale — never fail the sale for it.
  if (error) console.error("awardLoyaltyPoints failed:", error.message);
}

/** Reverses an order's points when it is refunded. Idempotent. */
export async function revokeLoyaltyPoints(orderId: string): Promise<void> {
  const { error } = await admin().rpc("revoke_loyalty_points", { p_order_id: orderId });
  if (error) console.error("revokeLoyaltyPoints failed:", error.message);
}
