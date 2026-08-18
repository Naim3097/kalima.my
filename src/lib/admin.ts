import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import {
  EDITORIAL_DEFAULTS,
  EDITORIAL_SLOTS,
  EDITORIAL_SLOT_LABELS,
  type EditorialSlot,
} from "@/lib/editorial";

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
  All figures are computed from *revenue-bearing* orders — money that arrived
  and stayed. One fetch of the last 30 days drives every card; the 14-day chart
  and recents are derived from it.

  `pending` is excluded because the money has not arrived: an order sits pending
  from the moment it is placed until the gateway confirms, and a cancelled or
  failed payment is never announced, so some of them stay pending forever.
  `cancelled` and `refunded` are excluded because it left again — counting a
  refund as revenue reports money the shop gave back.
*/
const REVENUE_BEARING = ["paid", "fulfilled", "completed"];
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
  const revenue = rows.filter((o) => REVENUE_BEARING.includes(o.status));

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
  if (filter?.q) {
    /*
      `or` takes a filter GRAMMAR, not a value: an unescaped comma or paren in
      the search box adds terms to the expression rather than searching for
      them. Staff-only and single-table, so the blast radius is small — but the
      shape is wrong, and this is the line that gets copied.
    */
    const q = filter.q.replace(/[,()\\]/g, " ").trim();
    if (q) query = query.or(`reference.ilike.%${q}%,email.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`listOrders failed: ${error.message}`);
  return (data ?? []).map((o) => toOrderRow(o as RawOrder));
}

export type OrderDetail = {
  reference: string; email: string; phone: string | null; status: OrderStatus;
  subtotalSen: number; discountSen: number; shippingSen: number; taxSen: number; totalSen: number;
  discountCode: string | null; shippingMethod: string | null;
  shippingAddress: Record<string, string> | null;
  createdAt: string; paidAt: string | null;
  refundedSen: number; refundedAt: string | null;
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
    subtotalSen: o.subtotal_sen, discountSen: o.discount_sen, shippingSen: o.shipping_sen,
    taxSen: o.tax_sen ?? 0, totalSen: o.total_sen,
    discountCode: o.discount_code, shippingMethod: o.shipping_method, shippingAddress: o.shipping_address,
    createdAt: o.created_at, paidAt: o.paid_at,
    refundedSen: o.refunded_sen ?? 0, refundedAt: o.refunded_at ?? null,
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

/* ---- Settings ----------------------------------------------------------- */

export type StoreSettings = {
  storeName: string; storeEmail: string; storePhone: string | null; currency: string;
  freeShippingThresholdSen: number; flatShippingSen: number; taxRateBps: number;
  /** Storefront profile URLs. Empty string = not set, so the icon is hidden. */
  socialInstagram: string; socialTiktok: string; socialFacebook: string; socialThreads: string;
  /** WhatsApp contact number, as typed. A number, not a URL. */
  socialWhatsapp: string;
};

export async function getStoreSettings(): Promise<StoreSettings> {
  const { data, error } = await db().from("store_settings").select("*").eq("id", 1).single();
  if (error) throw new Error(`getStoreSettings failed: ${error.message}`);
  return {
    storeName: data.store_name, storeEmail: data.store_email, storePhone: data.store_phone,
    currency: data.currency, freeShippingThresholdSen: data.free_shipping_threshold_sen,
    flatShippingSen: data.flat_shipping_sen, taxRateBps: data.tax_rate_bps,
    socialInstagram: data.social_instagram ?? "", socialTiktok: data.social_tiktok ?? "",
    socialFacebook: data.social_facebook ?? "", socialThreads: data.social_threads ?? "",
    socialWhatsapp: data.social_whatsapp ?? "",
  };
}

/* ---- Staff -------------------------------------------------------------- */

export type StaffUser = { id: string; name: string | null; email: string; role: string; createdAt: string };
export type RoleGrant = { email: string; role: string; createdAt: string };

/** All users with their roles, for staff management (reuses the customer join). */
export async function listUsers(): Promise<StaffUser[]> {
  const supabase = db();
  const { data: profiles, error } = await supabase
    .from("profiles").select("id, full_name, role, created_at").order("created_at", { ascending: false });
  if (error) throw new Error(`listUsers failed: ${error.message}`);

  const { data: authList } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const emailById = new Map((authList?.users ?? []).map((u) => [u.id, u.email ?? ""]));

  return (profiles ?? []).map((p) => ({
    id: p.id, name: p.full_name, email: emailById.get(p.id) ?? "", role: p.role, createdAt: p.created_at,
  }));
}

/** The bootstrap allowlist — emails granted a role the moment they sign up. */
export async function listRoleGrants(): Promise<RoleGrant[]> {
  const { data, error } = await db()
    .from("role_grants").select("email, role, created_at").order("created_at", { ascending: false });
  if (error) throw new Error(`listRoleGrants failed: ${error.message}`);
  return (data ?? []).map((g) => ({ email: g.email, role: g.role, createdAt: g.created_at }));
}

/* ---- CMS ---------------------------------------------------------------- */

export type AdminAnnouncement = { id: string; text: string; sortOrder: number; active: boolean };
export type AdminHeroSlide = {
  id: string; eyebrow: string | null; title: string; body: string | null; image: string; focal: string | null;
  zoom: number;
  primaryLabel: string | null; primaryHref: string | null; secondaryLabel: string | null; secondaryHref: string | null;
  sortOrder: number; active: boolean;
};
export type AdminContentPage = { id: string; slug: string; title: string; body: string[]; published: boolean };

export async function listAnnouncements(): Promise<AdminAnnouncement[]> {
  const { data, error } = await db()
    .from("announcements").select("id, text, sort_order, active").order("sort_order");
  if (error) throw new Error(`listAnnouncements failed: ${error.message}`);
  return (data ?? []).map((a) => ({ id: a.id, text: a.text, sortOrder: a.sort_order, active: a.active }));
}

export async function listHeroSlides(): Promise<AdminHeroSlide[]> {
  const { data, error } = await db()
    .from("hero_slides")
    .select("id, eyebrow, title, body, image, focal, zoom, primary_label, primary_href, secondary_label, secondary_href, sort_order, active")
    .order("sort_order");
  if (error) throw new Error(`listHeroSlides failed: ${error.message}`);
  return (data ?? []).map((s) => ({
    id: s.id, eyebrow: s.eyebrow, title: s.title, body: s.body, image: s.image, focal: s.focal,
    zoom: s.zoom ?? 1,
    primaryLabel: s.primary_label, primaryHref: s.primary_href,
    secondaryLabel: s.secondary_label, secondaryHref: s.secondary_href,
    sortOrder: s.sort_order, active: s.active,
  }));
}

/*
  The homepage's editorial slots, defaults merged with whatever the CMS has
  overridden — the same merge the storefront does, so the back office lists what
  a visitor sees rather than only the rows that happen to exist.

  `customised` is what tells them apart: it is what the Reset control keys off,
  and without it a slot showing its code default is indistinguishable from one
  somebody deliberately set to the same photograph.
*/
export type AdminEditorialImage = {
  slot: EditorialSlot;
  label: string;
  image: string;
  focal: string;
  zoom: number;
  alt: string;
  customised: boolean;
};

export async function listEditorialImages(): Promise<AdminEditorialImage[]> {
  const { data, error } = await db()
    .from("editorial_images")
    .select("slot, image, focal, zoom, alt");
  if (error) throw new Error(`listEditorialImages failed: ${error.message}`);

  const rows = new Map((data ?? []).map((r) => [r.slot as string, r]));

  return EDITORIAL_SLOTS.map((slot) => {
    const fallback = EDITORIAL_DEFAULTS[slot];
    const row = rows.get(slot);
    return {
      slot,
      label: EDITORIAL_SLOT_LABELS[slot],
      image: row?.image || fallback.image,
      focal: row?.focal || fallback.focal,
      zoom: row?.zoom ?? fallback.zoom,
      alt: row?.alt ?? fallback.alt,
      customised: Boolean(row),
    };
  });
}

export type AdminLookbookShot = {
  id: string;
  productId: string;
  productName: string;
  slug: string;
  colorName: string;
  alt: string | null;
  sortOrder: number;
  active: boolean;
  /** False when the chosen colourway has lost its photograph. */
  hasImage: boolean;
};

export async function listLookbookShots(): Promise<AdminLookbookShot[]> {
  const { data, error } = await db()
    .from("lookbook_shots")
    .select(
      `id, product_id, color_name, alt, sort_order, active,
       products ( name, slug, product_images ( color_name ) )`,
    )
    .order("sort_order");
  if (error) throw new Error(`listLookbookShots failed: ${error.message}`);

  return (data ?? []).map((s: Record<string, unknown>) => {
    const p = (s.products ?? {}) as {
      name?: string;
      slug?: string;
      product_images?: { color_name: string | null }[];
    };
    return {
      id: s.id as string,
      productId: s.product_id as string,
      productName: p.name ?? "(deleted product)",
      slug: p.slug ?? "",
      colorName: s.color_name as string,
      alt: (s.alt as string | null) ?? null,
      sortOrder: s.sort_order as number,
      active: s.active as boolean,
      /* Surfaced so the editor can flag a shot whose photo was removed after it
         was created — the storefront silently drops those, which is right for a
         shopper and useless for staff. */
      hasImage: (p.product_images ?? []).some((i) => i.color_name === s.color_name),
    };
  });
}

export type LookbookCandidate = {
  id: string;
  name: string;
  slug: string;
  /** Only colourways that actually have a photograph. */
  colors: string[];
};

/*
  Products that can be used as a Lookbook shot, with the colourways that have a
  photograph.

  OFFERS ONLY WHAT CAN RENDER. Constraining the picker is what keeps the
  storefront's "no image → drop the shot" branch nearly unreachable: a colourway
  with no photo never becomes a choice in the first place, so the only way to
  reach it is deleting a photo after the fact.
*/
export async function listLookbookCandidates(): Promise<LookbookCandidate[]> {
  const { data, error } = await db()
    .from("products")
    .select("id, name, slug, published, product_images ( color_name, position )")
    .eq("published", true)
    .order("name");
  if (error) throw new Error(`listLookbookCandidates failed: ${error.message}`);

  return (data ?? [])
    .map((p: Record<string, unknown>) => {
      const images = (p.product_images ?? []) as { color_name: string | null; position: number }[];
      const colors = [
        ...new Set(
          images
            .filter((i) => i.color_name)
            .sort((a, b) => a.position - b.position)
            .map((i) => i.color_name as string),
        ),
      ];
      return { id: p.id as string, name: p.name as string, slug: p.slug as string, colors };
    })
    .filter((p) => p.colors.length > 0);
}

/* ---- Sign-up popup ------------------------------------------------------- */

export type AdminSignupPromo = {
  enabled: boolean;
  eyebrow: string;
  heading: string;
  body: string;
  perks: string[];
  /* The offer itself, in ringgit. Independent of `enabled`: the popup is
     advertising, this is money, and either can be set without the other. */
  firstOrderDiscountRm: number;
  ctaLabel: string;
  ctaHref: string;
  delaySeconds: number;
  dismissDays: number;
};

export async function getSignupPromoAdmin(): Promise<AdminSignupPromo> {
  const client = db();

  const { data, error } = await client
    .from("signup_promo")
    .select("enabled, eyebrow, heading, body, perks, first_order_discount_sen, cta_label, cta_href, delay_seconds, dismiss_days")
    .eq("id", 1)
    .single();
  if (error) throw new Error(`getSignupPromoAdmin failed: ${error.message}`);

  return {
    enabled: data.enabled,
    eyebrow: data.eyebrow ?? "",
    heading: data.heading ?? "",
    body: data.body ?? "",
    perks: Array.isArray(data.perks) ? (data.perks as unknown[]).filter((p): p is string => typeof p === "string") : [],
    firstOrderDiscountRm: (data.first_order_discount_sen ?? 0) / 100,
    ctaLabel: data.cta_label ?? "",
    ctaHref: data.cta_href ?? "",
    delaySeconds: data.delay_seconds,
    dismissDays: data.dismiss_days,
  };
}

/* ---- Footer ------------------------------------------------------------- */

export type AdminFooterText = {
  companyName: string;
  companyRegNo: string;
  tagline: string;
  paymentNote: string;
};

export type AdminTrustItem = {
  id: string; icon: string; title: string; body: string | null;
  sortOrder: number; active: boolean;
};

export type AdminFooterLink = {
  id: string; columnId: string; label: string; href: string;
  sortOrder: number; active: boolean;
};

export type AdminFooterColumn = {
  id: string; heading: string; sortOrder: number; links: AdminFooterLink[];
};

/*
  The footer as the back office edits it — INACTIVE rows included, unlike the
  storefront read. This is the screen where something hidden gets restored, so
  it cannot be the screen that hides it.
*/
export async function getFooterText(): Promise<AdminFooterText> {
  const { data, error } = await db()
    .from("store_settings")
    .select("company_name, company_reg_no, footer_tagline, footer_payment_note")
    .eq("id", 1)
    .single();
  if (error) throw new Error(`getFooterText failed: ${error.message}`);
  return {
    companyName: data.company_name ?? "",
    companyRegNo: data.company_reg_no ?? "",
    tagline: data.footer_tagline ?? "",
    paymentNote: data.footer_payment_note ?? "",
  };
}

export async function listTrustItems(): Promise<AdminTrustItem[]> {
  const { data, error } = await db()
    .from("footer_trust")
    .select("id, icon, title, body, sort_order, active")
    .order("sort_order");
  if (error) throw new Error(`listTrustItems failed: ${error.message}`);
  return (data ?? []).map((t) => ({
    id: t.id, icon: t.icon, title: t.title, body: t.body,
    sortOrder: t.sort_order, active: t.active,
  }));
}

export async function listFooterColumns(): Promise<AdminFooterColumn[]> {
  const { data, error } = await db()
    .from("footer_link_columns")
    .select("id, heading, sort_order, footer_links ( id, column_id, label, href, sort_order, active )")
    .order("sort_order");
  if (error) throw new Error(`listFooterColumns failed: ${error.message}`);

  type Raw = {
    id: string; heading: string; sort_order: number;
    footer_links: { id: string; column_id: string; label: string; href: string; sort_order: number; active: boolean }[] | null;
  };

  return ((data ?? []) as unknown as Raw[]).map((c) => ({
    id: c.id,
    heading: c.heading,
    sortOrder: c.sort_order,
    links: (c.footer_links ?? [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((l) => ({
        id: l.id, columnId: l.column_id, label: l.label, href: l.href,
        sortOrder: l.sort_order, active: l.active,
      })),
  }));
}

/* ---- Instagram --------------------------------------------------------- */

export type AdminInstagramPost = {
  id: string;
  image: string;
  permalink: string;
  caption: string | null;
  mediaType: string;
  postedAt: string;
  productId: string | null;
  productName: string | null;
  hidden: boolean;
};

/*
  Every synced post, hidden ones included — this is the screen where hiding is
  undone, so it cannot be the screen that hides them from itself.
*/
export async function listInstagramPosts(): Promise<AdminInstagramPost[]> {
  const { data, error } = await db()
    .from("instagram_posts")
    .select("id, image, permalink, caption, media_type, posted_at, hidden, product_id, products ( name )")
    .order("posted_at", { ascending: false });
  if (error) throw new Error(`listInstagramPosts failed: ${error.message}`);

  type Row = {
    id: string; image: string; permalink: string; caption: string | null;
    media_type: string; posted_at: string; hidden: boolean; product_id: string | null;
    products: { name: string } | { name: string }[] | null;
  };

  return (data as unknown as Row[] ?? []).map((row) => {
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    return {
      id: row.id,
      image: row.image,
      permalink: row.permalink,
      caption: row.caption,
      mediaType: row.media_type,
      postedAt: row.posted_at,
      productId: row.product_id,
      productName: product?.name ?? null,
      hidden: row.hidden,
    };
  });
}

/*
  Products a post can be tagged with.

  NOT listLookbookCandidates(): that one requires colour-scoped photography,
  because a Lookbook row names a product AND one of its colourways. An Instagram
  post carries its own photograph and only needs somewhere to send the click, so
  narrowing to products that happen to have per-colour images would hide
  perfectly taggable ones.
*/
export type TaggableProduct = { id: string; name: string; slug: string };

export async function listTaggableProducts(): Promise<TaggableProduct[]> {
  const { data, error } = await db()
    .from("products").select("id, name, slug").eq("published", true).order("name");
  if (error) throw new Error(`listTaggableProducts failed: ${error.message}`);
  return (data ?? []).map((p) => ({ id: p.id, name: p.name, slug: p.slug }));
}

export async function listContentPages(): Promise<AdminContentPage[]> {
  const { data, error } = await db()
    .from("content_pages").select("id, slug, title, body, published").order("slug");
  if (error) throw new Error(`listContentPages failed: ${error.message}`);
  return (data ?? []).map((p) => ({
    id: p.id, slug: p.slug, title: p.title, body: (p.body as string[]) ?? [], published: p.published,
  }));
}

/* ---- Products (editor) -------------------------------------------------- */

export type EditVariant = {
  id: string; sku: string; colorName: string; colorHex: string; size: string;
  priceSen: number | null; stockOnHand: number; weightGrams: number;
  colorPosition: number; position: number;
};

/*
  A product photo. `colorName` null = the product-level shot (the PLP/PDP hero,
  lowest position wins); a colour scope makes it the swatch-click image for
  that colourway. `path` is the storage object key, kept so the file can be
  removed from the bucket when the row is deleted.
*/
export type EditImage = {
  id: string; url: string; path: string | null; alt: string | null;
  colorName: string | null; position: number;
};

/** A matching piece linked to this product, as the editor shows it. */
export type EditAddon = {
  /** The product_addons row id — what remove/reorder act on. */
  id: string;
  addonProductId: string;
  slug: string;
  /** The add-on product's own name, shown when no label overrides it. */
  productName: string;
  label: string | null;
  /** Pinned colourway. Null = the add-on's first colour by position. */
  colorName: string | null;
  sortOrder: number;
  active: boolean;
  /** Colourways the add-on product actually has, for the picker. */
  colors: string[];
};

export type ProductForEdit = {
  id: string; slug: string; name: string; description: string | null; fabric: string | null;
  category: "women" | "men" | "accessories"; priceSen: number;
  /** The "now" price. Null = not on sale; the storefront then shows priceSen plain. */
  salePriceSen: number | null;
  bestSeller: boolean; newArrival: boolean; tone: string; published: boolean;
  /** Whether the PDP offers the made-to-measure route. */
  offersCustomSizing: boolean;
  /** Product-level size chart image — one per product, no colour scope. */
  sizeChartUrl: string | null;
  variants: EditVariant[];
  images: EditImage[];
  addons: EditAddon[];
};

/** Distinct colourways of a product, ordered as the storefront orders them. */
function colorsOf(variants: { color_name: string; color_position: number }[]): string[] {
  return [...new Map(
    [...variants]
      .sort((a, b) => a.color_position - b.color_position)
      .map((v) => [v.color_name, true]),
  ).keys()];
}

export type AddonCandidate = { id: string; slug: string; name: string; colors: string[] };

/*
  Products that may be attached to this one as a matching piece.

  Excludes the product itself — the database rejects a self-link outright
  (product_addons_not_self), and offering it in the picker only to fail on save
  would be a worse way to learn that.

  Unpublished products are included: staff commonly stage a matching piece and
  publish both together, and the storefront's RLS already hides a link whose
  add-on is unpublished, so nothing leaks by allowing it here.
*/
export async function listAddonCandidates(excludeProductId: string): Promise<AddonCandidate[]> {
  const { data, error } = await db()
    .from("products")
    .select("id, slug, name, product_variants(color_name, color_position)")
    .neq("id", excludeProductId)
    .order("name", { ascending: true });
  if (error) throw new Error(`listAddonCandidates failed: ${error.message}`);

  return (data ?? []).map((p: Record<string, unknown>) => ({
    id: p.id as string,
    slug: p.slug as string,
    name: p.name as string,
    colors: colorsOf(
      (p.product_variants ?? []) as { color_name: string; color_position: number }[],
    ),
  }));
}

export async function getProductForEdit(slug: string): Promise<ProductForEdit | null> {
  const { data, error } = await db()
    .from("products")
    .select("*, product_variants(id, sku, color_name, color_hex, size, price_sen, stock_on_hand, weight_grams, color_position, position), product_images(id, url, storage_path, alt, color_name, position)")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`getProductForEdit failed: ${error.message}`);
  if (!data) return null;

  const images: EditImage[] = (data.product_images ?? [])
    .map((i: Record<string, unknown>) => ({
      id: i.id as string,
      url: i.url as string,
      path: (i.storage_path as string | null) ?? null,
      alt: (i.alt as string | null) ?? null,
      colorName: (i.color_name as string | null) ?? null,
      position: i.position as number,
    }))
    .sort((a: EditImage, b: EditImage) => a.position - b.position);

  const variants = (data.product_variants ?? [])
    .map((v: Record<string, unknown>) => ({
      id: v.id as string, sku: v.sku as string, colorName: v.color_name as string,
      colorHex: v.color_hex as string, size: v.size as string,
      priceSen: (v.price_sen as number | null) ?? null, stockOnHand: v.stock_on_hand as number,
      weightGrams: (v.weight_grams as number | null) ?? 0,
      colorPosition: v.color_position as number, position: v.position as number,
    }))
    .sort((a: EditVariant, b: EditVariant) => a.colorPosition - b.colorPosition || a.position - b.position);

  /*
    Add-ons come in a second query rather than an embed: product_addons has TWO
    foreign keys to products, so an embedded select would have to name which one
    it means, and the nested colour list is a second hop beyond that.
  */
  const { data: addonRows, error: addonErr } = await db()
    .from("product_addons")
    .select(`id, label, addon_color_name, sort_order, active,
             products:addon_product_id ( id, slug, name, product_variants(color_name, color_position) )`)
    .eq("parent_product_id", data.id as string)
    .order("sort_order", { ascending: true });
  if (addonErr) throw new Error(`getProductForEdit addons failed: ${addonErr.message}`);

  const addons: EditAddon[] = ((addonRows ?? []) as unknown as {
    id: string; label: string | null; addon_color_name: string | null;
    sort_order: number; active: boolean;
    products: {
      id: string; slug: string; name: string;
      product_variants: { color_name: string; color_position: number }[];
    } | null;
  }[])
    .filter((r) => r.products)
    .map((r) => ({
      id: r.id,
      addonProductId: r.products!.id,
      slug: r.products!.slug,
      productName: r.products!.name,
      label: r.label,
      colorName: r.addon_color_name,
      sortOrder: r.sort_order,
      active: r.active,
      colors: colorsOf(r.products!.product_variants ?? []),
    }));

  return {
    id: data.id, slug: data.slug, name: data.name, description: data.description, fabric: data.fabric,
    category: data.category, priceSen: data.price_sen,
    salePriceSen: (data.sale_price_sen as number | null) ?? null,
    bestSeller: data.best_seller,
    newArrival: data.new_arrival, tone: data.tone, published: data.published,
    offersCustomSizing: Boolean(data.offers_custom_sizing),
    sizeChartUrl: (data.size_chart_url as string | null) ?? null,
    variants, images, addons,
  };
}

/* ---- Products (list) ---------------------------------------------------- */

export type AdminProductRow = {
  id: string; slug: string; name: string; category: string;
  priceSen: number; salePriceSen: number | null;
  bestSeller: boolean; newArrival: boolean; published: boolean;
  tone: string; image: string | null;
  colorCount: number; sizeCount: number; stock: number;
};

/*
  The products table for the back office.

  Deliberately NOT fetchProducts(): that is the storefront read model and it
  filters to published rows, which meant an unpublished product vanished from
  the only screen that could publish it again. Staff need to see everything
  they can edit.
*/
export async function listProductsForAdmin(): Promise<AdminProductRow[]> {
  const { data, error } = await db()
    .from("products")
    .select("id, slug, name, category, price_sen, sale_price_sen, best_seller, new_arrival, published, tone, product_variants(color_name, size, stock_on_hand), product_images(url, color_name, position)")
    .order("name");
  if (error) throw new Error(`listProductsForAdmin failed: ${error.message}`);

  return (data ?? []).map((p) => {
    const variants = (p.product_variants ?? []) as { color_name: string; size: string; stock_on_hand: number }[];
    const images = (p.product_images ?? []) as { url: string; color_name: string | null; position: number }[];
    return {
      id: p.id, slug: p.slug, name: p.name, category: p.category,
      priceSen: p.price_sen, salePriceSen: (p.sale_price_sen as number | null) ?? null,
      bestSeller: p.best_seller, newArrival: p.new_arrival, published: p.published, tone: p.tone,
      // Same hero rule as the storefront: no colour scope, lowest position.
      image: images.filter((i) => !i.color_name).sort((a, b) => a.position - b.position)[0]?.url ?? null,
      colorCount: new Set(variants.map((v) => v.color_name)).size,
      sizeCount: new Set(variants.map((v) => v.size)).size,
      stock: variants.reduce((n, v) => n + v.stock_on_hand, 0),
    };
  });
}

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

/* ---- Audit log ---------------------------------------------------------- */

export type AuditEntry = {
  id: string;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  createdAt: string;
};

export type AuditFilters = { entityType?: string; actorEmail?: string };

/*
  The back-office trail, newest first. Capped at 200 rows — this is a "what
  just happened" screen, not an archive; the table itself keeps everything.
*/
export async function listAuditLog(filters: AuditFilters = {}): Promise<AuditEntry[]> {
  let q = db()
    .from("admin_audit_log")
    .select("id, actor_email, action, entity_type, entity_id, summary, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (filters.entityType) q = q.eq("entity_type", filters.entityType);
  if (filters.actorEmail) q = q.eq("actor_email", filters.actorEmail);

  const { data, error } = await q;
  if (error) throw new Error(`listAuditLog failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    actorEmail: r.actor_email,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    summary: r.summary,
    createdAt: r.created_at,
  }));
}

/** Distinct entity types and actors present in the log, for the filter chips. */
export async function getAuditFacets(): Promise<{ entityTypes: string[]; actors: string[] }> {
  const { data, error } = await db()
    .from("admin_audit_log")
    .select("entity_type, actor_email")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`getAuditFacets failed: ${error.message}`);
  return {
    entityTypes: [...new Set((data ?? []).map((r) => r.entity_type as string))].sort(),
    actors: [...new Set((data ?? []).map((r) => r.actor_email as string).filter(Boolean))].sort(),
  };
}

/* ---- Packing slips ------------------------------------------------------ */

/*
  Orders for the printable packing slips, in the order they were placed.

  Either an explicit list of references, or every order in a status (the daily
  "print everything I need to pack" run). Capped so an accidental unfiltered
  print can't try to render the entire order history.
*/
export async function getOrdersForPacking(opts: {
  references?: string[];
  status?: OrderStatus;
  limit?: number;
}): Promise<OrderDetail[]> {
  let q = db()
    .from("orders")
    .select("*, order_items(*), payments(provider, provider_ref, status, amount_sen)")
    .order("created_at", { ascending: true })
    .limit(opts.limit ?? 100);

  if (opts.references?.length) q = q.in("reference", opts.references);
  else if (opts.status) q = q.eq("status", opts.status);
  else return [];

  const { data, error } = await q;
  if (error) throw new Error(`getOrdersForPacking failed: ${error.message}`);

  return (data ?? []).map((o) => {
    const pay = (o.payments ?? [])[0];
    return {
      reference: o.reference, email: o.email, phone: o.phone, status: o.status,
      subtotalSen: o.subtotal_sen, discountSen: o.discount_sen, shippingSen: o.shipping_sen,
      taxSen: o.tax_sen ?? 0, totalSen: o.total_sen,
      discountCode: o.discount_code, shippingMethod: o.shipping_method,
      shippingAddress: o.shipping_address,
      createdAt: o.created_at, paidAt: o.paid_at,
      refundedSen: o.refunded_sen ?? 0, refundedAt: o.refunded_at ?? null,
      items: (o.order_items ?? []).map((i: Record<string, unknown>) => ({
        productName: i.product_name as string, colorName: i.color_name as string,
        size: i.size as string, sku: i.variant_sku as string, qty: i.qty as number,
        unitSen: i.unit_price_sen as number, lineSen: i.line_total_sen as number,
      })),
      payment: pay
        ? { provider: pay.provider, providerRef: pay.provider_ref, status: pay.status, amountSen: pay.amount_sen }
        : null,
    };
  });
}

/* ---- Shipments ---------------------------------------------------------- */

export type ShipmentStatus =
  | "pending" | "booked" | "in_transit" | "delivered" | "returned" | "cancelled";

export type Shipment = {
  id: string;
  provider: string;
  courier: string | null;
  trackingNo: string | null;
  trackingUrl: string | null;
  labelUrl: string | null;
  status: ShipmentStatus;
  weightGrams: number;
  costSen: number;
  notes: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
};

export async function listShipments(orderReference: string): Promise<Shipment[]> {
  const { data, error } = await db()
    .from("shipments")
    .select("*, orders!inner(reference)")
    .eq("orders.reference", orderReference)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listShipments failed: ${error.message}`);
  return (data ?? []).map((s) => ({
    id: s.id, provider: s.provider, courier: s.courier,
    trackingNo: s.tracking_no, trackingUrl: s.tracking_url, labelUrl: s.label_url,
    status: s.status, weightGrams: s.weight_grams, costSen: s.cost_sen,
    notes: s.notes, shippedAt: s.shipped_at, deliveredAt: s.delivered_at,
    createdAt: s.created_at,
  }));
}

/*
  Total parcel weight for an order, summed from the variant weights. This is
  what a courier rate quote is priced on, so a zero here means the catalog is
  missing weights rather than that the parcel is weightless.
*/
export async function getOrderWeightGrams(orderReference: string): Promise<number> {
  const { data, error } = await db()
    .from("orders")
    .select("reference, order_items(qty, product_variants(weight_grams))")
    .eq("reference", orderReference)
    .maybeSingle();
  if (error) throw new Error(`getOrderWeightGrams failed: ${error.message}`);
  return (data?.order_items ?? []).reduce((total: number, i: Record<string, unknown>) => {
    const v = i.product_variants as { weight_grams?: number } | null;
    return total + (i.qty as number) * (v?.weight_grams ?? 0);
  }, 0);
}

/* ---- Shipping settings (EasyParcel) ------------------------------------- */

export type SenderSettings = {
  easyparcelEnabled: boolean;
  /* What the CUSTOMER is charged. Distinct from everything else here, which is
     about booking the parcel: EasyParcel prices what the shop pays a courier,
     these decide what appears on the order.

     Two Malaysian zones, because Sabah and Sarawak cost more to reach than
     Semenanjung. Overseas is not here — it is whatever courier the customer
     picks at checkout. */
  shippingWestSen: number;
  shippingEastSen: number;
  flatShippingSen: number;
  /* Spend at which shipping becomes free. 0 = no free shipping — see the
     free_shipping_threshold_off_at_zero migration. */
  freeShippingThresholdSen: number;
  connected: boolean;
  fallbackEnabled: boolean;
  senderName: string | null;
  senderPhone: string | null;
  senderLine1: string | null;
  senderLine2: string | null;
  senderCity: string | null;
  senderPostcode: string | null;
  senderState: string | null;
};

export async function getSenderSettings(): Promise<SenderSettings> {
  const { data, error } = await db()
    .from("store_settings")
    .select("easyparcel_enabled, easyparcel_access_token, shipping_fallback_enabled, flat_shipping_sen, shipping_west_sen, shipping_east_sen, free_shipping_threshold_sen, sender_name, sender_phone, sender_line1, sender_line2, sender_city, sender_postcode, sender_state")
    .eq("id", 1)
    .single();
  if (error) throw new Error(`getSenderSettings failed: ${error.message}`);
  return {
    easyparcelEnabled: Boolean(data.easyparcel_enabled),
    connected: Boolean(data.easyparcel_access_token),
    fallbackEnabled: Boolean(data.shipping_fallback_enabled),
    shippingWestSen: data.shipping_west_sen ?? 1000,
    shippingEastSen: data.shipping_east_sen ?? 1500,
    flatShippingSen: data.flat_shipping_sen ?? 0,
    freeShippingThresholdSen: data.free_shipping_threshold_sen ?? 0,
    senderName: data.sender_name, senderPhone: data.sender_phone,
    senderLine1: data.sender_line1, senderLine2: data.sender_line2,
    senderCity: data.sender_city, senderPostcode: data.sender_postcode,
    senderState: data.sender_state,
  };
}

/* ---- Campaigns ---------------------------------------------------------- */

export type CampaignRow = {
  id: string; name: string; channel: string; subject: string | null; body: string;
  segment: Record<string, unknown>; status: string;
  totalCount: number; sentCount: number; failedCount: number;
  sentAt: string | null; createdAt: string;
};

export async function listCampaigns(): Promise<CampaignRow[]> {
  const { data, error } = await db()
    .from("campaigns")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`listCampaigns failed: ${error.message}`);
  return (data ?? []).map((c) => ({
    id: c.id, name: c.name, channel: c.channel, subject: c.subject, body: c.body,
    segment: (c.segment ?? {}) as Record<string, unknown>, status: c.status,
    totalCount: c.total_count, sentCount: c.sent_count, failedCount: c.failed_count,
    sentAt: c.sent_at, createdAt: c.created_at,
  }));
}

/** Subscriber counts for the composer's context line. */
export async function getSubscriberStats(): Promise<{ active: number; optedOut: number }> {
  const client = db();
  const [{ count: active }, { count: optedOut }] = await Promise.all([
    client.from("newsletter_subscribers").select("id", { count: "exact", head: true }).is("unsubscribed_at", null),
    client.from("newsletter_subscribers").select("id", { count: "exact", head: true }).not("unsubscribed_at", "is", null),
  ]);
  return { active: active ?? 0, optedOut: optedOut ?? 0 };
}
