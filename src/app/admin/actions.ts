"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, isStaff, type Role } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { parseCsvRecords } from "@/lib/csv";
import {
  CATEGORIES,
  parseBool,
  rmToSen,
  slugify,
  toInt,
  type CsvCategory,
} from "@/lib/catalog-csv";

const ROLES: Role[] = ["customer", "staff", "admin", "affiliate"];

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

/*
  Appends one row to the audit trail. getCurrentUser is cache()-wrapped, so
  resolving the actor here costs nothing on top of the assertStaff call the
  action already made.

  Logging must never break the mutation it describes: a failure here is
  swallowed, because refusing a legitimate edit over a bookkeeping error is the
  worse outcome. Call this only AFTER the write succeeds, so the trail records
  what actually happened rather than what was attempted.
*/
async function logAudit(
  db: ReturnType<typeof createAdminClient>,
  entry: {
    action: string;
    entityType: string;
    entityId?: string | null;
    summary: string;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const current = await getCurrentUser();
    await db?.from("admin_audit_log").insert({
      actor_id: current?.user.id ?? null,
      actor_email: current?.user.email ?? null,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      summary: entry.summary,
      meta: entry.meta ?? null,
    });
  } catch {
    // Deliberately ignored — see above.
  }
}

// Statuses staff may set by hand. Two are deliberately excluded: 'paid'
// belongs to the payment webhook, and 'refunded' belongs to refundOrder, which
// also returns the goods to stock. Allowing it here made a refund a bare label
// change that left inventory permanently understated.
const SETTABLE = new Set(["fulfilled", "completed", "cancelled"]);

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

  await logAudit(db, {
    action: "order.status_changed",
    entityType: "order",
    entityId: reference,
    summary: `Order ${reference} marked ${status}`,
    meta: { status },
  });

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${reference}`);
  return { ok: true };
}

/*
  Records a refund and returns the goods to stock.

  The MONEY is moved in the LeanX dashboard — LeanX publishes no refund API, so
  nothing here can move it for you. This records what happened on our side:
  status, refunded amount, payment row, and the stock coming back through the
  ledger. If LeanX later pushes a `refunded` webhook for the same order, the
  underlying function is idempotent and will not restock twice.
*/
export async function refundOrder(input: {
  reference: string;
  amountSen: number;
  restock: boolean;
  reason: string;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const { data: order, error: readErr } = await db
    .from("orders").select("id, total_sen, status").eq("reference", input.reference).maybeSingle();
  if (readErr) return { error: readErr.message };
  if (!order) return { error: "Order not found." };

  if (!Number.isInteger(input.amountSen) || input.amountSen <= 0) {
    return { error: "Enter a refund amount greater than zero." };
  }
  if (input.amountSen > (order.total_sen as number)) {
    return { error: "Refund can't exceed the order total." };
  }

  const { data, error } = await db.rpc("refund_order", {
    p_order_id: order.id as string,
    p_amount_sen: input.amountSen,
    p_restock: input.restock,
    p_reason: input.reason,
  });
  if (error) {
    return { error: error.message.includes("only a settled order")
      ? "Only a paid or fulfilled order can be refunded."
      : error.message };
  }

  const result = data as { status: string };
  await logAudit(db, {
    action: "order.refunded",
    entityType: "order",
    entityId: input.reference,
    summary: result.status === "already_refunded"
      ? `Order ${input.reference} was already refunded — no change`
      : `Order ${input.reference} refunded ${(input.amountSen / 100).toFixed(2)} MYR` +
        `${input.restock ? " (stock returned)" : " (stock not returned)"}` +
        `${input.reason.trim() ? ` — ${input.reason.trim()}` : ""}`,
    meta: { amountSen: input.amountSen, restock: input.restock, reason: input.reason, result: result.status },
  });

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${input.reference}`);
  revalidateProduct(); // stock changed, so the storefront catalog is stale
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

  await logAudit(db, {
    action: input.id ? "discount.updated" : "discount.created",
    entityType: "discount",
    entityId: input.id ?? code,
    summary: `Discount ${code} ${input.id ? "updated" : "created"}`,
    meta: { ...row },
  });

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
  const { data, error } = await db
    .from("discount_codes").update({ active }).eq("id", id).select("code").single();
  if (error) return { error: error.message };

  await logAudit(db, {
    action: "discount.toggled",
    entityType: "discount",
    entityId: id,
    summary: `Discount ${data?.code ?? id} ${active ? "enabled" : "disabled"}`,
    meta: { active },
  });

  revalidatePath("/admin/discounts");
  return { ok: true };
}

/* ---- Products ----------------------------------------------------------- */

// slugify lives in @/lib/catalog-csv so the editor and the CSV importer derive
// slugs identically.

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

  await logAudit(db, {
    action: input.id ? "product.updated" : "product.created",
    entityType: "product",
    entityId: slug,
    summary: `Product "${name}" ${input.id ? "updated" : "created"}`,
    meta: { priceSen: input.priceSen, published: input.published },
  });

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

  await logAudit(db, {
    action: "variant.created",
    entityType: "variant",
    entityId: sku,
    summary: `Variant ${sku} (${input.colorName} / ${input.size}) added to ${input.productSlug}`,
    meta: { productSlug: input.productSlug, initialStock: input.initialStock },
  });

  revalidateProduct(input.productSlug);
  return { ok: true };
}

export async function deleteVariant(id: string, productSlug: string): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  // Read the SKU first — after the delete there is nothing left to name it by.
  const { data: existing } = await db
    .from("product_variants").select("sku").eq("id", id).maybeSingle();

  // A variant that appears in an order is FK-restricted — surface that clearly.
  const { error } = await db.from("product_variants").delete().eq("id", id);
  if (error) {
    return { error: error.message.includes("foreign key") || error.message.includes("violates")
      ? "Can't delete a variant that appears in an order."
      : error.message };
  }

  await logAudit(db, {
    action: "variant.deleted",
    entityType: "variant",
    entityId: (existing?.sku as string | undefined) ?? id,
    summary: `Variant ${existing?.sku ?? id} deleted from ${productSlug}`,
    meta: { productSlug },
  });

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

  await logAudit(db, {
    action: "stock.adjusted",
    entityType: "variant",
    entityId: variantId,
    summary: `Stock ${delta > 0 ? "+" : ""}${delta} on ${productSlug} → ${data as number} (${reason || "no reason given"})`,
    meta: { delta, reason, newStock: data as number, productSlug },
  });

  revalidateProduct(productSlug);
  return { ok: true, newStock: data as number };
}

/* ---- Catalog CSV import ------------------------------------------------- */

export type ImportSummary = {
  productsCreated: number;
  productsUpdated: number;
  variantsCreated: number;
  variantsUpdated: number;
  stockAdjusted: number;
  errors: { row: number; message: string }[];
};

/*
  Bulk catalog import — one row per variant, product columns repeated (the
  shape the export route emits, so a round-trip works).

  Two rules this must not break:
  - money is parsed from ringgit into integer sen at the boundary; sen is the
    only thing that reaches the database
  - stock is NEVER written directly. New variants seed through adjust_stock and
    existing ones move by a computed delta, so every unit is accounted for in
    the stock_movements ledger exactly as a manual adjustment would be.

  Validation runs over the whole file first: if any row is malformed nothing is
  written, so a typo on line 40 can't leave the catalog half-imported.
*/
export async function importCatalogCsv(
  csvText: string,
): Promise<(ActionResult & { summary?: ImportSummary }) | { error: string }> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const records = parseCsvRecords(csvText);
  if (!records.length) return { error: "That file has no data rows." };

  const errors: { row: number; message: string }[] = [];
  type Parsed = {
    row: number; slug: string; name: string; description: string; fabric: string;
    category: CsvCategory; priceSen: number; bestSeller: boolean; newArrival: boolean;
    tone: string; published: boolean;
    sku: string; colorName: string; colorHex: string; size: string;
    variantPriceSen: number | null; weightGrams: number; stock: number | null;
  };
  const parsed: Parsed[] = [];

  records.forEach((r, i) => {
    const row = i + 2; // +1 for the header, +1 for 1-based lines
    const name = r.name ?? "";
    const slug = slugify(r.slug || name);
    if (!slug) {
      errors.push({ row, message: "Needs a slug or a name." });
      return;
    }
    if (!name) {
      errors.push({ row, message: "Product name is required." });
      return;
    }
    const category = (r.category || "women").toLowerCase() as CsvCategory;
    if (!CATEGORIES.includes(category)) {
      errors.push({ row, message: `Category must be one of ${CATEGORIES.join(", ")}.` });
      return;
    }
    const priceSen = rmToSen(r.price_rm ?? "");
    if (priceSen === null || Number.isNaN(priceSen)) {
      errors.push({ row, message: "price_rm must be a number." });
      return;
    }
    const variantPriceSen = rmToSen(r.variant_price_rm ?? "");
    if (Number.isNaN(variantPriceSen)) {
      errors.push({ row, message: "variant_price_rm must be a number or blank." });
      return;
    }
    const weightGrams = toInt(r.weight_grams ?? "", 0);
    if (Number.isNaN(weightGrams)) {
      errors.push({ row, message: "weight_grams must be a whole number." });
      return;
    }
    const stockRaw = (r.stock ?? "").trim();
    const stock = stockRaw === "" ? null : toInt(stockRaw, 0);
    if (stock !== null && Number.isNaN(stock)) {
      errors.push({ row, message: "stock must be a whole number of 0 or more." });
      return;
    }
    const colorName = (r.color_name ?? "").trim();
    const size = (r.size ?? "").trim();
    // A row may describe the product only (no variant); but a half-filled
    // variant is a typo we should catch rather than silently drop.
    if ((colorName && !size) || (!colorName && size)) {
      errors.push({ row, message: "A variant needs both color_name and size." });
      return;
    }

    parsed.push({
      row, slug, name, description: r.description ?? "", fabric: r.fabric ?? "",
      category, priceSen, bestSeller: parseBool(r.best_seller ?? "", false),
      newArrival: parseBool(r.new_arrival ?? "", false),
      tone: (r.tone ?? "").trim() || "#383c61",
      published: parseBool(r.published ?? "", true),
      sku: (r.sku ?? "").trim().toUpperCase(), colorName,
      colorHex: (r.color_hex ?? "").trim() || "#cccccc",
      size, variantPriceSen, weightGrams, stock,
    });
  });

  if (errors.length) {
    return { error: `Nothing was imported — ${errors.length} row(s) need fixing.`, summary: {
      productsCreated: 0, productsUpdated: 0, variantsCreated: 0, variantsUpdated: 0,
      stockAdjusted: 0, errors: errors.slice(0, 25),
    } } as ActionResult & { summary: ImportSummary };
  }

  const summary: ImportSummary = {
    productsCreated: 0, productsUpdated: 0, variantsCreated: 0,
    variantsUpdated: 0, stockAdjusted: 0, errors: [],
  };

  // Group rows by product so each product is written once.
  const groups = new Map<string, Parsed[]>();
  for (const p of parsed) {
    const list = groups.get(p.slug);
    if (list) list.push(p);
    else groups.set(p.slug, [p]);
  }

  for (const [slug, rows] of groups) {
    const head = rows[0];
    const productRow = {
      name: head.name, slug,
      description: head.description.trim() || null,
      fabric: head.fabric.trim() || null,
      category: head.category,
      price_sen: head.priceSen,
      best_seller: head.bestSeller,
      new_arrival: head.newArrival,
      tone: head.tone,
      published: head.published,
    };

    const { data: existing } = await db
      .from("products").select("id").eq("slug", slug).maybeSingle();

    let productId: string;
    if (existing?.id) {
      const { error } = await db.from("products").update(productRow).eq("id", existing.id);
      if (error) { summary.errors.push({ row: head.row, message: error.message }); continue; }
      productId = existing.id as string;
      summary.productsUpdated += 1;
    } else {
      const { data, error } = await db
        .from("products").insert(productRow).select("id").single();
      if (error || !data) {
        summary.errors.push({ row: head.row, message: error?.message ?? "Insert failed" });
        continue;
      }
      productId = data.id as string;
      summary.productsCreated += 1;
    }

    // Existing variants, to decide insert vs update and to compute stock deltas.
    const { data: current } = await db
      .from("product_variants")
      .select("id, sku, color_name, size, stock_on_hand, color_position, position")
      .eq("product_id", productId);
    const byKey = new Map<string, Record<string, unknown>>();
    for (const v of current ?? []) {
      byKey.set(`sku:${(v.sku as string).toUpperCase()}`, v);
      byKey.set(`cs:${(v.color_name as string).toLowerCase()}|${(v.size as string).toLowerCase()}`, v);
    }

    // Colour/size ordering follows first appearance in the file.
    const colorOrder = new Map<string, number>();
    let nextPosition = (current ?? []).length;

    for (const r of rows) {
      if (!r.colorName || !r.size) continue; // product-only row

      const sku = r.sku ||
        `KLM-${slug}-${r.colorName}-${r.size}`.toUpperCase().replace(/[^A-Z0-9-]+/g, "");
      const match =
        byKey.get(`sku:${sku.toUpperCase()}`) ??
        byKey.get(`cs:${r.colorName.toLowerCase()}|${r.size.toLowerCase()}`);

      if (!colorOrder.has(r.colorName.toLowerCase())) {
        colorOrder.set(r.colorName.toLowerCase(), colorOrder.size);
      }

      if (match) {
        const { error } = await db.from("product_variants").update({
          sku,
          color_name: r.colorName,
          color_hex: r.colorHex,
          size: r.size,
          price_sen: r.variantPriceSen,
          weight_grams: r.weightGrams,
        }).eq("id", match.id as string);
        if (error) { summary.errors.push({ row: r.row, message: error.message }); continue; }
        summary.variantsUpdated += 1;

        // Stock moves by delta, through the ledger — never a direct write.
        if (r.stock !== null) {
          const delta = r.stock - (match.stock_on_hand as number);
          if (delta !== 0) {
            const { error: adjErr } = await db.rpc("adjust_stock", {
              p_variant_id: match.id as string, p_delta: delta, p_reason: "CSV import",
            });
            if (adjErr) summary.errors.push({ row: r.row, message: adjErr.message });
            else summary.stockAdjusted += 1;
          }
        }
      } else {
        const { data: inserted, error } = await db.from("product_variants").insert({
          product_id: productId,
          sku,
          color_name: r.colorName,
          color_hex: r.colorHex,
          size: r.size,
          price_sen: r.variantPriceSen,
          weight_grams: r.weightGrams,
          stock_on_hand: 0, // seeded through the ledger below
          color_position: colorOrder.get(r.colorName.toLowerCase()) ?? 0,
          position: nextPosition++,
        }).select("id").single();
        if (error || !inserted) {
          summary.errors.push({
            row: r.row,
            message: error?.message.includes("unique")
              ? `SKU ${sku} or that colour/size already exists.`
              : (error?.message ?? "Insert failed"),
          });
          continue;
        }
        summary.variantsCreated += 1;

        if (r.stock && r.stock > 0) {
          const { error: adjErr } = await db.rpc("adjust_stock", {
            p_variant_id: inserted.id as string, p_delta: r.stock, p_reason: "CSV import",
          });
          if (adjErr) summary.errors.push({ row: r.row, message: adjErr.message });
          else summary.stockAdjusted += 1;
        }
      }
    }

    revalidateProduct(slug);
  }

  await logAudit(db, {
    action: "catalog.imported",
    entityType: "catalog",
    entityId: null,
    summary:
      `CSV import — ${summary.productsCreated} products added, ${summary.productsUpdated} updated, ` +
      `${summary.variantsCreated} variants added, ${summary.variantsUpdated} updated, ` +
      `${summary.stockAdjusted} stock adjustments`,
    meta: { ...summary },
  });

  return { ok: true, summary };
}

/* ---- Product images ----------------------------------------------------- */

const IMAGE_BUCKET = "product-images";
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif",
};

/*
  Mints a short-lived signed upload URL so the browser PUTs the file straight
  to Storage. Keeping the bytes out of the server action avoids the request
  body limit entirely and means the browser never holds write credentials —
  the token is scoped to this one object key.
*/
export async function createImageUploadUrl(
  productId: string, contentType: string, sizeBytes: number,
): Promise<{ path: string; token: string } | { error: string }> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  if (!ALLOWED_IMAGE_TYPES.has(contentType)) return { error: "Use a JPEG, PNG, WebP or AVIF image." };
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return { error: "That file looks empty." };
  if (sizeBytes > MAX_IMAGE_BYTES) return { error: "Images must be 5 MB or smaller." };

  // Random key — never trust the client's filename for the object path.
  const path = `${productId}/${crypto.randomUUID()}.${EXT_BY_TYPE[contentType]}`;
  const { data, error } = await db.storage.from(IMAGE_BUCKET).createSignedUploadUrl(path);
  if (error) return { error: error.message };
  return { path: data.path, token: data.token };
}

/*
  Records an uploaded object as a product image. Called after the browser's
  PUT succeeds; appends to the end of the current order.
*/
export async function attachProductImage(input: {
  productId: string; productSlug: string; path: string;
  alt?: string; colorName?: string | null;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  // Verify the object really exists before we point a row at it.
  const { data: pub } = db.storage.from(IMAGE_BUCKET).getPublicUrl(input.path);
  if (!pub?.publicUrl) return { error: "Could not resolve the uploaded image." };

  const { data: last } = await db
    .from("product_images")
    .select("position")
    .eq("product_id", input.productId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await db.from("product_images").insert({
    product_id: input.productId,
    url: pub.publicUrl,
    storage_path: input.path,
    alt: input.alt?.trim() || null,
    color_name: input.colorName?.trim() || null,
    position: ((last?.position as number | undefined) ?? -1) + 1,
  });
  if (error) return { error: error.message };

  await logAudit(db, {
    action: "image.added", entityType: "product", entityId: input.productSlug,
    summary: `Image added to ${input.productSlug}`, meta: { path: input.path },
  });

  revalidateProduct(input.productSlug);
  return { ok: true };
}

/* Alt text / colour scope for an existing image. */
export async function updateProductImage(input: {
  imageId: string; productSlug: string; alt?: string; colorName?: string | null;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const { error } = await db
    .from("product_images")
    .update({ alt: input.alt?.trim() || null, color_name: input.colorName?.trim() || null })
    .eq("id", input.imageId);
  if (error) return { error: error.message };

  await logAudit(db, {
    action: "image.updated", entityType: "product", entityId: input.productSlug,
    summary: `Image details updated on ${input.productSlug}`,
    meta: { imageId: input.imageId, colorName: input.colorName ?? null },
  });

  revalidateProduct(input.productSlug);
  return { ok: true };
}

/* Removes the row and, when it came from Storage, the underlying file. */
export async function deleteProductImage(
  imageId: string, productSlug: string,
): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const { data: row, error: readErr } = await db
    .from("product_images")
    .select("storage_path")
    .eq("id", imageId)
    .maybeSingle();
  if (readErr) return { error: readErr.message };

  const { error } = await db.from("product_images").delete().eq("id", imageId);
  if (error) return { error: error.message };

  // Best-effort cleanup — a stranded object must never fail the delete.
  const path = row?.storage_path as string | null | undefined;
  if (path) await db.storage.from(IMAGE_BUCKET).remove([path]).catch(() => {});

  await logAudit(db, {
    action: "image.deleted", entityType: "product", entityId: productSlug,
    summary: `Image removed from ${productSlug}`, meta: { imageId, path },
  });

  revalidateProduct(productSlug);
  return { ok: true };
}

/*
  Persists a drag-sorted order. Position drives which shot is the hero (lowest
  wins), so this is the ordering the storefront reads.
*/
export async function reorderProductImages(
  orderedIds: string[], productSlug: string,
): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }
  if (!orderedIds.length) return { ok: true };

  const results = await Promise.all(
    orderedIds.map((id, i) => db.from("product_images").update({ position: i }).eq("id", id)),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };

  await logAudit(db, {
    action: "image.reordered", entityType: "product", entityId: productSlug,
    summary: `Image order changed on ${productSlug}`, meta: { count: orderedIds.length },
  });

  revalidateProduct(productSlug);
  return { ok: true };
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
  await logAudit(db, {
    action: input.id ? "announcement.updated" : "announcement.created",
    entityType: "cms", entityId: input.id ?? null,
    summary: `Announcement ${input.id ? "updated" : "created"}: "${row.text}"`,
    meta: { active: input.active },
  });
  revalidatePath("/admin/cms");
  revalidateStorefront();
  return { ok: true };
}

export async function deleteAnnouncement(id: string): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }
  const { error } = await db.from("announcements").delete().eq("id", id);
  if (error) return { error: error.message };
  await logAudit(db, {
    action: "announcement.deleted", entityType: "cms", entityId: id,
    summary: "Announcement deleted",
  });
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
  await logAudit(db, {
    action: input.id ? "hero_slide.updated" : "hero_slide.created",
    entityType: "cms", entityId: input.id ?? null,
    summary: `Hero slide ${input.id ? "updated" : "created"}: "${row.title}"`,
    meta: { active: input.active },
  });
  revalidatePath("/admin/cms");
  revalidateStorefront();
  return { ok: true };
}

export async function deleteHeroSlide(id: string): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }
  const { error } = await db.from("hero_slides").delete().eq("id", id);
  if (error) return { error: error.message };
  await logAudit(db, {
    action: "hero_slide.deleted", entityType: "cms", entityId: id,
    summary: "Hero slide deleted",
  });
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
  await logAudit(db, {
    action: input.id ? "page.updated" : "page.created",
    entityType: "cms", entityId: slug,
    summary: `Content page "${row.title}" ${input.id ? "updated" : "created"}`,
    meta: { published: input.published },
  });
  revalidatePath("/admin/cms");
  revalidatePath(`/pages/${slug}`);
  return { ok: true, slug };
}

/* ---- Settings ----------------------------------------------------------- */

export async function saveSettings(input: {
  storeName: string; storeEmail: string; storePhone: string; currency: string;
  freeShippingThresholdSen: number; flatShippingSen: number; taxRateBps: number;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  if (!input.storeName.trim()) return { error: "Store name is required." };
  if (input.freeShippingThresholdSen < 0 || input.flatShippingSen < 0) {
    return { error: "Shipping amounts can't be negative." };
  }
  if (input.taxRateBps < 0 || input.taxRateBps > 10000) {
    return { error: "Tax rate must be between 0% and 100%." };
  }

  const { error } = await db.from("store_settings").update({
    store_name: input.storeName.trim(),
    store_email: input.storeEmail.trim(),
    store_phone: input.storePhone.trim() || null,
    currency: input.currency.trim() || "MYR",
    free_shipping_threshold_sen: input.freeShippingThresholdSen,
    flat_shipping_sen: input.flatShippingSen,
    tax_rate_bps: input.taxRateBps,
  }).eq("id", 1);

  if (error) return { error: error.message };
  await logAudit(db, {
    action: "settings.updated", entityType: "settings", entityId: "store",
    summary: "Store settings updated",
    meta: {
      freeShippingThresholdSen: input.freeShippingThresholdSen,
      flatShippingSen: input.flatShippingSen, taxRateBps: input.taxRateBps,
    },
  });
  revalidatePath("/admin/settings");
  revalidatePath("/", "layout"); // storefront reads shipping threshold for display
  return { ok: true };
}

/* ---- Staff -------------------------------------------------------------- */

export async function setUserRole(userId: string, role: string): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  if (!ROLES.includes(role as Role)) return { error: "Unknown role." };

  // Lockout guard: an admin can't strip their own admin (would lock themselves out).
  const current = await getCurrentUser();
  if (current && current.user.id === userId && current.role === "admin" && role !== "admin") {
    return { error: "You can't remove your own admin access." };
  }

  // Service-role write — allowed through protect_profile_role; sync_role_to_jwt
  // propagates to the user's JWT claim on their next refresh.
  const { error } = await db.from("profiles").update({ role }).eq("id", userId);
  if (error) return { error: error.message };
  await logAudit(db, {
    action: "user.role_changed", entityType: "user", entityId: userId,
    summary: `Role changed to ${role}`, meta: { role },
  });
  revalidatePath("/admin/staff");
  return { ok: true };
}

export async function addRoleGrant(email: string, role: string): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }
  const clean = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return { error: "Enter a valid email." };
  if (!ROLES.includes(role as Role)) return { error: "Unknown role." };

  const { error } = await db.from("role_grants").upsert({ email: clean, role }, { onConflict: "email" });
  if (error) return { error: error.message };
  await logAudit(db, {
    action: "role_grant.added", entityType: "user", entityId: clean,
    summary: `${clean} pre-authorised as ${role}`, meta: { role },
  });
  revalidatePath("/admin/staff");
  return { ok: true };
}

export async function removeRoleGrant(email: string): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }
  const { error } = await db.from("role_grants").delete().eq("email", email);
  if (error) return { error: error.message };
  await logAudit(db, {
    action: "role_grant.removed", entityType: "user", entityId: email,
    summary: `${email} removed from the access allowlist`,
  });
  revalidatePath("/admin/staff");
  return { ok: true };
}
