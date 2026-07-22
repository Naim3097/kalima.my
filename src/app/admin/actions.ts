"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

/*
  Revalidate both the admin view and the storefront surfaces a catalog edit
  affects, so a change shows immediately rather than waiting out ISR.
*/
function revalidateProduct(slug?: string) {
  revalidatePath("/admin/products");
  revalidatePath("/", "layout"); // storefront catalog (home, PLPs)
  if (slug) {
    revalidatePath(`/admin/products/${slug}`);
    revalidatePath(`/products/${slug}`);
  }
}

/*
  Back-office mutations. Server actions are POST endpoints callable from
  anywhere, so each RE-VERIFIES a staff session before touching the admin
  (service-role) client — the /admin route guard is not enough on its own.
*/

async function assertStaff() {
  const current = await getCurrentUser();
  if (!current || !isStaff(current.role)) throw new Error("Not authorized");
  const client = createAdminClient();
  if (!client) throw new Error("Admin is not configured");
  return client;
}

export type ActionResult = { ok: true } | { error: string };

// Statuses staff may set by hand. 'paid' is deliberately excluded — that
// transition belongs to the payment webhook only.
const SETTABLE = new Set(["fulfilled", "completed", "cancelled", "refunded"]);

export async function updateOrderStatus(reference: string, status: string): Promise<ActionResult> {
  if (!SETTABLE.has(status)) return { error: "That status can't be set manually." };
  let db;
  try {
    db = await assertStaff();
  } catch {
    return { error: "Not authorized." };
  }

  const patch: Record<string, unknown> = { status };
  if (status === "cancelled") patch.cancelled_at = new Date().toISOString();

  const { error } = await db.from("orders").update(patch).eq("reference", reference);
  if (error) return { error: error.message };

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${reference}`);
  return { ok: true };
}

/* ---- Discounts ---------------------------------------------------------- */

export async function saveDiscount(input: {
  id?: string;
  code: string;
  kind: "percent" | "fixed" | "free_shipping";
  amount: number;
  minSpendSen: number;
  maxRedemptions: number | null;
  active: boolean;
}): Promise<ActionResult> {
  let db;
  try {
    db = await assertStaff();
  } catch {
    return { error: "Not authorized." };
  }

  const code = input.code.trim().toUpperCase();
  if (!code) return { error: "Code is required." };
  if (input.kind === "percent" && (input.amount < 1 || input.amount > 100)) {
    return { error: "Percentage must be between 1 and 100." };
  }
  if (input.kind === "fixed" && input.amount < 1) {
    return { error: "Fixed amount must be at least 1 sen." };
  }

  const row = {
    code,
    kind: input.kind,
    amount: input.kind === "free_shipping" ? 0 : input.amount,
    min_spend_sen: input.minSpendSen,
    max_redemptions: input.maxRedemptions,
    active: input.active,
  };

  const { error } = input.id
    ? await db.from("discount_codes").update(row).eq("id", input.id)
    : await db.from("discount_codes").insert(row);

  if (error) {
    return { error: error.message.includes("unique") ? "That code already exists." : error.message };
  }

  revalidatePath("/admin/discounts");
  return { ok: true };
}

export async function toggleDiscount(id: string, active: boolean): Promise<ActionResult> {
  let db;
  try {
    db = await assertStaff();
  } catch {
    return { error: "Not authorized." };
  }
  const { error } = await db.from("discount_codes").update({ active }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/discounts");
  return { ok: true };
}

/* ---- Products ----------------------------------------------------------- */

const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export type ProductInput = {
  id?: string;
  name: string;
  slug: string;
  description: string;
  fabric: string;
  category: "women" | "men" | "accessories";
  priceSen: number;
  bestSeller: boolean;
  newArrival: boolean;
  tone: string;
  published: boolean;
};

export async function saveProduct(input: ProductInput): Promise<ActionResult & { slug?: string }> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const name = input.name.trim();
  if (!name) return { error: "Name is required." };
  const slug = slugify(input.slug || name);
  if (!slug) return { error: "Could not derive a slug — check the name." };
  if (input.priceSen < 0) return { error: "Price cannot be negative." };

  const row = {
    name, slug,
    description: input.description.trim() || null,
    fabric: input.fabric.trim() || null,
    category: input.category,
    price_sen: input.priceSen,
    best_seller: input.bestSeller,
    new_arrival: input.newArrival,
    tone: input.tone.trim() || "#383c61",
    published: input.published,
  };

  const { error } = input.id
    ? await db.from("products").update(row).eq("id", input.id)
    : await db.from("products").insert(row);

  if (error) {
    return { error: error.message.includes("unique") ? "That slug is already in use." : error.message };
  }
  revalidateProduct(slug);
  return { ok: true, slug };
}

export async function addVariant(input: {
  productId: string; productSlug: string;
  colorName: string; colorHex: string; size: string; sku: string;
  priceSen: number | null; initialStock: number; colorPosition: number; position: number;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  if (!input.colorName.trim() || !input.size.trim()) return { error: "Colour and size are required." };
  const sku = input.sku.trim().toUpperCase() ||
    `KLM-${input.productSlug}-${input.colorName}-${input.size}`.toUpperCase().replace(/[^A-Z0-9-]+/g, "");

  const { data, error } = await db.from("product_variants").insert({
    product_id: input.productId,
    sku,
    color_name: input.colorName.trim(),
    color_hex: input.colorHex.trim() || "#cccccc",
    size: input.size.trim(),
    price_sen: input.priceSen,
    stock_on_hand: 0, // initial stock is added via the ledger below
    color_position: input.colorPosition,
    position: input.position,
  }).select("id").single();

  if (error) {
    return { error: error.message.includes("unique") ? "That SKU or colour/size already exists." : error.message };
  }

  // Seed initial stock through the ledger so inventory has an audit trail.
  if (input.initialStock > 0) {
    const { error: adjErr } = await db.rpc("adjust_stock", {
      p_variant_id: data.id, p_delta: input.initialStock, p_reason: "initial stock",
    });
    if (adjErr) return { error: adjErr.message };
  }

  revalidateProduct(input.productSlug);
  return { ok: true };
}

export async function deleteVariant(id: string, productSlug: string): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  // A variant that appears in an order is FK-restricted — surface that clearly.
  const { error } = await db.from("product_variants").delete().eq("id", id);
  if (error) {
    return { error: error.message.includes("foreign key") || error.message.includes("violates")
      ? "Can't delete a variant that appears in an order."
      : error.message };
  }
  revalidateProduct(productSlug);
  return { ok: true };
}

export async function adjustStock(
  variantId: string, delta: number, reason: string, productSlug: string,
): Promise<ActionResult & { newStock?: number }> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  if (!Number.isInteger(delta) || delta === 0) return { error: "Enter a non-zero whole number." };

  const { data, error } = await db.rpc("adjust_stock", {
    p_variant_id: variantId, p_delta: delta, p_reason: reason,
  });
  if (error) {
    return { error: error.message.includes("below zero") ? "That would take stock below zero." : error.message };
  }
  revalidateProduct(productSlug);
  return { ok: true, newStock: data as number };
}

/* ---- CMS ---------------------------------------------------------------- */

// Storefront surfaces the CMS drives — revalidated on every content edit.
function revalidateStorefront() {
  revalidatePath("/", "layout"); // announcements (in the layout) + hero (home)
}

export async function saveAnnouncement(input: {
  id?: string; text: string; sortOrder: number; active: boolean;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }
  if (!input.text.trim()) return { error: "Message text is required." };

  const row = { text: input.text.trim(), sort_order: input.sortOrder, active: input.active };
  const { error } = input.id
    ? await db.from("announcements").update(row).eq("id", input.id)
    : await db.from("announcements").insert(row);
  if (error) return { error: error.message };
  revalidatePath("/admin/cms");
  revalidateStorefront();
  return { ok: true };
}

export async function deleteAnnouncement(id: string): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }
  const { error } = await db.from("announcements").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/cms");
  revalidateStorefront();
  return { ok: true };
}

export async function saveHeroSlide(input: {
  id?: string; eyebrow: string; title: string; body: string; image: string; focal: string;
  primaryLabel: string; primaryHref: string; secondaryLabel: string; secondaryHref: string;
  sortOrder: number; active: boolean;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }
  if (!input.title.trim()) return { error: "Title is required." };
  if (!input.image.trim()) return { error: "Image path is required." };

  const row = {
    eyebrow: input.eyebrow.trim() || null,
    title: input.title.trim(),
    body: input.body.trim() || null,
    image: input.image.trim(),
    focal: input.focal.trim() || "center",
    primary_label: input.primaryLabel.trim() || null,
    primary_href: input.primaryHref.trim() || null,
    secondary_label: input.secondaryLabel.trim() || null,
    secondary_href: input.secondaryHref.trim() || null,
    sort_order: input.sortOrder,
    active: input.active,
  };
  const { error } = input.id
    ? await db.from("hero_slides").update(row).eq("id", input.id)
    : await db.from("hero_slides").insert(row);
  if (error) return { error: error.message };
  revalidatePath("/admin/cms");
  revalidateStorefront();
  return { ok: true };
}

export async function deleteHeroSlide(id: string): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }
  const { error } = await db.from("hero_slides").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/cms");
  revalidateStorefront();
  return { ok: true };
}

export async function saveContentPage(input: {
  id?: string; slug: string; title: string; body: string[]; published: boolean;
}): Promise<ActionResult & { slug?: string }> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }
  const slug = slugify(input.slug || input.title);
  if (!slug) return { error: "A slug is required." };
  if (!input.title.trim()) return { error: "Title is required." };

  const body = input.body.map((p) => p.trim()).filter(Boolean);
  const row = { slug, title: input.title.trim(), body, published: input.published };
  const { error } = input.id
    ? await db.from("content_pages").update(row).eq("id", input.id)
    : await db.from("content_pages").insert(row);
  if (error) {
    return { error: error.message.includes("unique") ? "That slug is already in use." : error.message };
  }
  revalidatePath("/admin/cms");
  revalidatePath(`/pages/${slug}`);
  return { ok: true, slug };
}
