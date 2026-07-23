import "server-only";

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
      .select("id, price_sen, products!inner(slug, published, price_sen)")
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
    // Variant override, else product base price — the same rule create_order uses.
    const product = data.products as unknown as { price_sen: number };
    const unit = data.price_sen ?? product.price_sen;
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
export async function createOrder(params: {
  items: CartLine[];
  email: string;
  phone?: string;
  address: OrderAddress;
  shippingMethod: string;
  discountCode?: string;
}): Promise<CreateOrderResult> {
  const auth = await createClient();
  const userId = auth ? (await auth.auth.getUser()).data.user?.id ?? null : null;

  const { data, error } = await admin().rpc("create_order", {
    p_user_id: userId,
    p_items: params.items,
    p_email: params.email,
    p_phone: params.phone ?? null,
    p_address: params.address,
    p_shipping_method: params.shippingMethod,
    p_discount_code: params.discountCode ?? null,
  });
  if (error) throw new Error(`createOrder failed: ${error.message}`);
  return data as CreateOrderResult;
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
  providerRef: string;
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
*/
export async function getOrderForCheckout(
  reference: string,
  email: string,
): Promise<{
  id: string;
  reference: string;
  email: string;
  phone: string | null;
  total_sen: number;
  status: string;
  shipping_address: OrderAddress | null;
} | null> {
  const { data, error } = await admin()
    .from("orders")
    .select("id, reference, email, phone, total_sen, status, shipping_address")
    .eq("reference", reference)
    .ilike("email", email)
    .maybeSingle();
  if (error) throw new Error(`getOrderForCheckout failed: ${error.message}`);
  return data ?? null;
}

/*
  Records the pending payment attempt at bill creation (guide §4). The webhook
  later upserts this row to paid via mark_order_paid, keyed on (provider,
  provider_ref) — so the bill_no is the idempotency anchor.
*/
export async function recordPendingPayment(
  orderId: string,
  providerRef: string,
  amountSen: number,
): Promise<void> {
  const { error } = await admin().from("payments").insert({
    order_id: orderId,
    provider: "leanx",
    provider_ref: providerRef,
    status: "pending",
    amount_sen: amountSen,
  });
  if (error) throw new Error(`recordPendingPayment failed: ${error.message}`);
}

/*
  Resolves a webhook's bill_no back to its order (primary match). Falls back to
  the invoice_ref (order reference) when no pending payment row is found.
*/
export async function resolveWebhookOrder(
  providerRef: string | undefined,
  orderReference: string | undefined,
): Promise<{ id: string; total_sen: number; email: string; reference: string } | null> {
  const supabase = admin();

  if (providerRef) {
    const { data } = await supabase
      .from("payments")
      .select("order_id, orders(id, total_sen, email, reference)")
      .eq("provider", "leanx")
      .eq("provider_ref", providerRef)
      .maybeSingle();
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
