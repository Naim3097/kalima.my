import "server-only";

import { createAdminClient } from "@/lib/supabase/server";

/*
  Back-office data access (Phase 3). Staff-only screens, so everything runs
  through the admin client after the /admin route guard (proxy + layout) has
  already confirmed a staff/admin session. Read models here; mutations are
  server actions in src/app/admin/actions.ts.
*/

function db() {
  const client = createAdminClient();
  if (!client) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set — admin requires it.");
  return client;
}

export type OrderStatus = "pending" | "paid" | "fulfilled" | "completed" | "cancelled" | "refunded";

/* ---- Dashboard ---------------------------------------------------------- */

export type DashboardStats = {
  salesTodaySen: number;
  sales7dSen: number;
  sales30dSen: number;
  ordersToday: number;
  paidOrders30d: number;
  aov30dSen: number;
  pendingOrders: number;
  topProducts: { name: string; qty: number; revenueSen: number }[];
  sales14d: { date: string; sen: number }[];
  recent: OrderRow[];
};

/*
  All figures are computed from *revenue-bearing* orders (status not pending /
  cancelled). One fetch of the last 30 days drives every card; the 14-day chart
  and recents are derived from it.
*/
export async function getDashboardStats(): Promise<DashboardStats> {
  const supabase = db();
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString();

  const { data, error } = await supabase
    .from("orders")
    .select("reference, email, status, total_sen, created_at, paid_at, shipping_address, order_items(product_name, qty, line_total_sen)")
    .gte("created_at", since30)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`getDashboardStats failed: ${error.message}`);

  const rows = data ?? [];
  const revenue = rows.filter((o) => !["pending", "cancelled"].includes(o.status));

  const now = Date.now();
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const sumSince = (ms: number) =>
    revenue.filter((o) => new Date(o.created_at).getTime() >= now - ms).reduce((n, o) => n + o.total_sen, 0);

  const salesTodaySen = revenue
    .filter((o) => new Date(o.created_at) >= startOfToday)
    .reduce((n, o) => n + o.total_sen, 0);
  const ordersToday = revenue.filter((o) => new Date(o.created_at) >= startOfToday).length;

  // Top products by units, over the 30-day window.
  const byProduct = new Map<string, { qty: number; revenueSen: number }>();
  for (const o of revenue) {
    for (const it of o.order_items ?? []) {
      const cur = byProduct.get(it.product_name) ?? { qty: 0, revenueSen: 0 };
      cur.qty += it.qty; cur.revenueSen += it.line_total_sen;
      byProduct.set(it.product_name, cur);
    }
  }
  const topProducts = [...byProduct.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  // 14-day sales series (fill empty days with 0).
  const days: { date: string; sen: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const next = new Date(d); next.setDate(d.getDate() + 1);
    const sen = revenue
      .filter((o) => { const t = new Date(o.created_at); return t >= d && t < next; })
      .reduce((n, o) => n + o.total_sen, 0);
    days.push({ date: d.toISOString().slice(0, 10), sen });
  }

  const paid30 = revenue.length;
  const gross30 = sumSince(30 * 864e5);

  return {
    salesTodaySen,
    sales7dSen: sumSince(7 * 864e5),
    sales30dSen: gross30,
    ordersToday,
    paidOrders30d: paid30,
    aov30dSen: paid30 ? Math.round(gross30 / paid30) : 0,
    pendingOrders: rows.filter((o) => o.status === "pending").length,
    topProducts,
    sales14d: days,
    recent: rows.slice(0, 6).map((o) => toOrderRow(o as unknown as RawOrder)),
  };
}

/* ---- Orders ------------------------------------------------------------- */

export type OrderRow = {
  reference: string;
  email: string;
  customerName: string | null;
  status: OrderStatus;
  totalSen: number;
  createdAt: string;
  itemCount: number;
};

type RawOrder = {
  reference: string; email: string; status: OrderStatus; total_sen: number; created_at: string;
  shipping_address: { recipient?: string } | null;
  order_items?: { qty: number }[];
};

function toOrderRow(o: RawOrder): OrderRow {
  return {
    reference: o.reference,
    email: o.email,
    customerName: o.shipping_address?.recipient ?? null,
    status: o.status,
    totalSen: o.total_sen,
    createdAt: o.created_at,
    itemCount: (o.order_items ?? []).reduce((n, i) => n + i.qty, 0),
  };
}

export async function listOrders(filter?: { status?: OrderStatus; q?: string }): Promise<OrderRow[]> {
  let query = db()
    .from("orders")
    .select("reference, email, status, total_sen, created_at, shipping_address, order_items(qty)")
    .order("created_at", { ascending: false })
    .limit(100);

  if (filter?.status) query = query.eq("status", filter.status);
  if (filter?.q) query = query.or(`reference.ilike.%${filter.q}%,email.ilike.%${filter.q}%`);

  const { data, error } = await query;
  if (error) throw new Error(`listOrders failed: ${error.message}`);
  return (data ?? []).map((o) => toOrderRow(o as RawOrder));
}

export type OrderDetail = {
  reference: string; email: string; phone: string | null; status: OrderStatus;
  subtotalSen: number; discountSen: number; shippingSen: number; totalSen: number;
  discountCode: string | null; shippingMethod: string | null;
  shippingAddress: Record<string, string> | null;
  createdAt: string; paidAt: string | null;
  items: { productName: string; colorName: string; size: string; sku: string; qty: number; unitSen: number; lineSen: number }[];
  payment: { provider: string; providerRef: string | null; status: string; amountSen: number } | null;
};

export async function getOrder(reference: string): Promise<OrderDetail | null> {
  const supabase = db();
  const { data: o, error } = await supabase
    .from("orders")
    .select("*, order_items(*), payments(provider, provider_ref, status, amount_sen)")
    .eq("reference", reference)
    .maybeSingle();
  if (error) throw new Error(`getOrder failed: ${error.message}`);
  if (!o) return null;

  const pay = (o.payments ?? [])[0];
  return {
    reference: o.reference, email: o.email, phone: o.phone, status: o.status,
    subtotalSen: o.subtotal_sen, discountSen: o.discount_sen, shippingSen: o.shipping_sen, totalSen: o.total_sen,
    discountCode: o.discount_code, shippingMethod: o.shipping_method, shippingAddress: o.shipping_address,
    createdAt: o.created_at, paidAt: o.paid_at,
    items: (o.order_items ?? []).map((i: Record<string, unknown>) => ({
      productName: i.product_name as string, colorName: i.color_name as string, size: i.size as string,
      sku: i.variant_sku as string, qty: i.qty as number, unitSen: i.unit_price_sen as number, lineSen: i.line_total_sen as number,
    })),
    payment: pay
      ? { provider: pay.provider, providerRef: pay.provider_ref, status: pay.status, amountSen: pay.amount_sen }
      : null,
  };
}

/* ---- Customers ---------------------------------------------------------- */

export type CustomerRow = {
  id: string; name: string | null; email: string; phone: string | null;
  role: string; marketingConsent: boolean; createdAt: string;
  orderCount: number; ltvSen: number;
};

/*
  Customers with lifetime value and order count. LTV counts revenue-bearing
  orders only. Email lives on auth.users, joined server-side.
*/
export async function listCustomers(): Promise<CustomerRow[]> {
  const supabase = db();

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role, marketing_consent, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listCustomers failed: ${error.message}`);

  const ids = (profiles ?? []).map((p) => p.id);
  if (!ids.length) return [];

  // Emails from the auth admin API; orders for LTV in one pass.
  const { data: authList } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const emailById = new Map((authList?.users ?? []).map((u) => [u.id, u.email ?? ""]));

  const { data: orders } = await supabase
    .from("orders")
    .select("user_id, total_sen, status")
    .in("user_id", ids);

  const stats = new Map<string, { count: number; ltv: number }>();
  for (const o of orders ?? []) {
    if (!o.user_id || ["pending", "cancelled"].includes(o.status)) continue;
    const cur = stats.get(o.user_id) ?? { count: 0, ltv: 0 };
    cur.count += 1; cur.ltv += o.total_sen;
    stats.set(o.user_id, cur);
  }

  return (profiles ?? []).map((p) => ({
    id: p.id, name: p.full_name, email: emailById.get(p.id) ?? "", phone: p.phone,
    role: p.role, marketingConsent: p.marketing_consent, createdAt: p.created_at,
    orderCount: stats.get(p.id)?.count ?? 0, ltvSen: stats.get(p.id)?.ltv ?? 0,
  }));
}

/* ---- Discounts ---------------------------------------------------------- */

export type DiscountRow = {
  id: string; code: string; kind: string; amount: number; minSpendSen: number;
  maxRedemptions: number | null; redeemedCount: number; active: boolean; endsAt: string | null;
};

export async function listDiscounts(): Promise<DiscountRow[]> {
  const { data, error } = await db()
    .from("discount_codes")
    .select("id, code, kind, amount, min_spend_sen, max_redemptions, redeemed_count, active, ends_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listDiscounts failed: ${error.message}`);
  return (data ?? []).map((d) => ({
    id: d.id, code: d.code, kind: d.kind, amount: d.amount, minSpendSen: d.min_spend_sen,
    maxRedemptions: d.max_redemptions, redeemedCount: d.redeemed_count, active: d.active, endsAt: d.ends_at,
  }));
}
