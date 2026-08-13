"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, isStaff, type Role } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { parseCsvRecords } from "@/lib/csv";
import { getOrder } from "@/lib/admin";
import { awardLoyaltyPoints } from "@/lib/commerce";
import { easyparcelClient, getShippingConfig } from "@/lib/shipping/config";
import { getRatesForOrder, receiverFrom, senderFrom } from "@/lib/shipping/rates";
import { disconnectChannel, markConnectedViaEnvironment } from "@/lib/channels/tokens";
import { verifyMetaMessagingCredentials, verifyWhatsAppCredentials } from "@/lib/channels/meta";
import { enqueueFullResync } from "@/lib/channels/sync";
import { addNote, sendReply } from "@/lib/channels/inbox";
import {
  CHANNEL_LABEL,
  channelDoes,
  isChannel,
  type MetaMessagingChannel,
} from "@/lib/channels/types";
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

  // Completion is when Kalima Club points are earned.
  if (status === "completed") {
    const { data: o } = await db
      .from("orders").select("id").eq("reference", reference).maybeSingle();
    if (o) await awardLoyaltyPoints(o.id as string);
  }

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

/*
  Parcel weight for a variant, in grams.

  Courier rates are priced on weight, so this is a prerequisite for any live
  rate quote. It was previously reachable only through the CSV import, which
  made it invisible to anyone editing a single product.
*/
export async function setVariantWeight(
  variantId: string, weightGrams: number, productSlug: string,
): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  if (!Number.isInteger(weightGrams) || weightGrams < 0) {
    return { error: "Weight must be a whole number of grams, 0 or more." };
  }

  const { error } = await db
    .from("product_variants").update({ weight_grams: weightGrams }).eq("id", variantId);
  if (error) return { error: error.message };

  await logAudit(db, {
    action: "variant.weight_set", entityType: "variant", entityId: variantId,
    summary: `Variant weight set to ${weightGrams} g on ${productSlug}`,
    meta: { weightGrams, productSlug },
  });

  revalidateProduct(productSlug);
  return { ok: true };
}

/*
  Pickup address and EasyParcel toggles. The address is what the courier
  collects from, so a wrong postcode here misprices every quote.
*/
export async function saveSenderSettings(input: {
  easyparcelEnabled: boolean;
  fallbackEnabled: boolean;
  senderName: string;
  senderPhone: string;
  senderLine1: string;
  senderLine2: string;
  senderCity: string;
  senderPostcode: string;
  senderState: string;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  if (input.easyparcelEnabled) {
    if (!input.senderPostcode.trim() || !input.senderState.trim()) {
      return { error: "A pickup postcode and state are required to use EasyParcel." };
    }
    const { stateToIso } = await import("@/lib/shipping/states");
    if (!stateToIso(input.senderState)) {
      return { error: `"${input.senderState}" is not a recognised Malaysian state.` };
    }
  }

  const { error } = await db.from("store_settings").update({
    easyparcel_enabled: input.easyparcelEnabled,
    shipping_fallback_enabled: input.fallbackEnabled,
    sender_name: input.senderName.trim() || null,
    sender_phone: input.senderPhone.trim() || null,
    sender_line1: input.senderLine1.trim() || null,
    sender_line2: input.senderLine2.trim() || null,
    sender_city: input.senderCity.trim() || null,
    sender_postcode: input.senderPostcode.trim() || null,
    sender_state: input.senderState.trim() || null,
  }).eq("id", 1);
  if (error) return { error: error.message };

  await logAudit(db, {
    action: "shipping.settings_updated", entityType: "settings", entityId: "shipping",
    summary: `Shipping settings updated (EasyParcel ${input.easyparcelEnabled ? "on" : "off"})`,
    meta: { easyparcelEnabled: input.easyparcelEnabled, postcode: input.senderPostcode },
  });

  revalidatePath("/admin/shipping");
  return { ok: true };
}

/** Disconnects the EasyParcel account (clears stored tokens). */
export async function disconnectEasyparcel(): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }
  const { disconnect } = await import("@/lib/shipping/config");
  await disconnect();
  await logAudit(db, {
    action: "shipping.disconnected", entityType: "settings", entityId: "shipping",
    summary: "EasyParcel account disconnected",
  });
  revalidatePath("/admin/shipping");
  return { ok: true };
}

/** Wallet balance for the Settings screen, in sen. */
export async function getEasyparcelWallet(): Promise<{ balanceSen: number } | { error: string }> {
  try { await assertStaff(); } catch { return { error: "Not authorized." }; }
  try {
    const client = await easyparcelClient();
    return { balanceSen: await client.getWalletBalanceSen() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not reach EasyParcel." };
  }
}

/* ---- Affiliates --------------------------------------------------------- */

const AFFILIATE_STATUSES = new Set(["pending", "approved", "suspended"]);

/*
  Approve, suspend, and set commission.

  Approval is the gate every downstream fraud guard depends on — a pending or
  suspended affiliate accrues nothing — so it is deliberately a staff-only
  action and is audit-logged with who did it.
*/
export async function updateAffiliate(input: {
  id: string;
  status?: string;
  commissionBps?: number;
  discountCode?: string;
  payoutNote?: string;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const patch: Record<string, unknown> = {};

  if (input.status !== undefined) {
    if (!AFFILIATE_STATUSES.has(input.status)) return { error: "Unknown status." };
    patch.status = input.status;
  }
  if (input.commissionBps !== undefined) {
    if (!Number.isInteger(input.commissionBps) || input.commissionBps < 0 || input.commissionBps > 10000) {
      return { error: "Commission must be between 0% and 100%." };
    }
    patch.commission_bps = input.commissionBps;
  }
  if (input.discountCode !== undefined) {
    patch.discount_code = input.discountCode.trim().toUpperCase() || null;
  }
  if (input.payoutNote !== undefined) patch.payout_note = input.payoutNote.trim() || null;

  if (!Object.keys(patch).length) return { ok: true };

  const { data, error } = await db
    .from("affiliates").update(patch).eq("id", input.id).select("name, status").single();
  if (error) {
    return { error: error.message.includes("unique") ? "That discount code is already assigned." : error.message };
  }

  await logAudit(db, {
    action: "affiliate.updated", entityType: "affiliate", entityId: input.id,
    summary: `Affiliate ${data.name} updated${input.status ? ` — ${input.status}` : ""}`,
    meta: patch,
  });

  revalidatePath("/admin/affiliates");
  revalidatePath("/affiliate");
  return { ok: true };
}

/*
  Records a payout and settles the referrals it covers.

  Only referrals that are past their hold period are settled — paying inside the
  return window is exactly what the hold exists to prevent. Clawed-back rows are
  never included. The payout row and the referral rows are written together so
  the ledger and the payment history cannot disagree.
*/
export async function recordAffiliatePayout(input: {
  affiliateId: string;
  reference: string;
  note: string;
}): Promise<ActionResult & { amountSen?: number; count?: number }> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const nowIso = new Date().toISOString();

  // Payable = past hold, not paid, not clawed back.
  const { data: due, error: dueErr } = await db
    .from("affiliate_referrals")
    .select("id, commission_sen")
    .eq("affiliate_id", input.affiliateId)
    .in("status", ["pending", "approved"])
    .lte("hold_until", nowIso);
  if (dueErr) return { error: dueErr.message };

  if (!due?.length) return { error: "Nothing is payable yet — commission is still within its hold period." };

  const amountSen = due.reduce((sum, r) => sum + (r.commission_sen as number), 0);
  if (amountSen <= 0) return { error: "Payable balance is zero." };

  const { data: payout, error: payErr } = await db.from("affiliate_payouts").insert({
    affiliate_id: input.affiliateId,
    amount_sen: amountSen,
    reference: input.reference.trim() || null,
    note: input.note.trim() || null,
  }).select("id").single();
  if (payErr) return { error: payErr.message };

  const { error: settleErr } = await db
    .from("affiliate_referrals")
    .update({ status: "paid", paid_at: nowIso, payout_id: payout.id as string })
    .in("id", due.map((r) => r.id as string));
  if (settleErr) return { error: settleErr.message };

  await logAudit(db, {
    action: "affiliate.paid_out", entityType: "affiliate", entityId: input.affiliateId,
    summary: `Paid ${(amountSen / 100).toFixed(2)} MYR across ${due.length} referral(s)` +
      `${input.reference.trim() ? ` — ref ${input.reference.trim()}` : ""}`,
    meta: { amountSen, count: due.length, reference: input.reference },
  });

  revalidatePath("/admin/affiliates");
  revalidatePath("/affiliate");
  return { ok: true, amountSen, count: due.length };
}

/* ---- Campaigns ---------------------------------------------------------- */

export type SegmentInput = {
  buyersOnly?: boolean;
  minSpentSen?: number;
  activeWithinDays?: number;
  inactiveForDays?: number;
};

/** Audience size for the composer, so staff see who they are about to mail. */
export async function previewAudience(
  segment: SegmentInput,
): Promise<{ count: number; sample: string[] } | { error: string }> {
  try { await assertStaff(); } catch { return { error: "Not authorized." }; }
  try {
    const { resolveAudience } = await import("@/lib/messaging/audience");
    const list = await resolveAudience(segment);
    return { count: list.length, sample: list.slice(0, 5).map((r) => r.email) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not resolve the audience." };
  }
}

export async function saveCampaign(input: {
  id?: string; name: string; subject: string; body: string; segment: SegmentInput;
}): Promise<ActionResult & { id?: string }> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  if (!input.name.trim()) return { error: "Give the campaign a name." };
  if (!input.body.trim()) return { error: "The message body can't be empty." };

  const row = {
    name: input.name.trim(),
    subject: input.subject.trim() || input.name.trim(),
    body: input.body,
    segment: input.segment,
    channel: "email" as const,
  };

  const { data, error } = input.id
    ? await db.from("campaigns").update(row).eq("id", input.id).select("id").single()
    : await db.from("campaigns").insert(row).select("id").single();
  if (error) return { error: error.message };

  await logAudit(db, {
    action: input.id ? "campaign.updated" : "campaign.created",
    entityType: "campaign", entityId: data.id as string,
    summary: `Campaign "${row.name}" ${input.id ? "updated" : "created"}`,
    meta: { segment: input.segment },
  });

  revalidatePath("/admin/campaigns");
  return { ok: true, id: data.id as string };
}

/*
  Sends a campaign. This mails real customers, so it is deliberately a separate,
  explicit action from saving — and the underlying pipeline claims the campaign
  (draft -> sending) before the first message, so a double click cannot mail the
  whole list twice.
*/
export async function sendCampaignNow(
  campaignId: string,
): Promise<ActionResult & { report?: { total: number; sent: number; failed: number } }> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const { sendCampaign } = await import("@/lib/messaging/send");
  const result = await sendCampaign(campaignId);
  if ("error" in result) return { error: result.error };

  await logAudit(db, {
    action: "campaign.sent", entityType: "campaign", entityId: campaignId,
    summary: `Campaign sent — ${result.sent} delivered, ${result.failed} failed of ${result.total}`,
    meta: { ...result },
  });

  revalidatePath("/admin/campaigns");
  return { ok: true, report: result };
}

export async function deleteCampaign(id: string): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }
  const { error } = await db.from("campaigns").delete().eq("id", id).eq("status", "draft");
  if (error) return { error: error.message };
  await logAudit(db, {
    action: "campaign.deleted", entityType: "campaign", entityId: id,
    summary: "Draft campaign deleted",
  });
  revalidatePath("/admin/campaigns");
  return { ok: true };
}

/* ---- Shipments ---------------------------------------------------------- */

const SHIPMENT_STATUSES = new Set([
  "pending", "booked", "in_transit", "delivered", "returned", "cancelled",
]);

/*
  Records a parcel against an order.

  Provider is 'manual' — a counter-dropped parcel — until EasyParcel's API is
  wired, at which point a booking writes the same row with provider set and a
  label URL attached. Marking a shipment as sent also moves the order to
  'fulfilled', because in practice those are one action for the packer.
*/
export async function saveShipment(input: {
  reference: string;
  id?: string;
  courier: string;
  trackingNo: string;
  status: string;
  weightGrams: number;
  costSen: number;
  notes: string;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  if (!SHIPMENT_STATUSES.has(input.status)) return { error: "Unknown shipment status." };
  if (input.weightGrams < 0 || input.costSen < 0) return { error: "Weight and cost can't be negative." };

  const { data: order, error: readErr } = await db
    .from("orders").select("id, status").eq("reference", input.reference).maybeSingle();
  if (readErr) return { error: readErr.message };
  if (!order) return { error: "Order not found." };

  const shipped = ["booked", "in_transit", "delivered"].includes(input.status);
  const row = {
    order_id: order.id as string,
    courier: input.courier.trim() || null,
    tracking_no: input.trackingNo.trim() || null,
    status: input.status,
    weight_grams: input.weightGrams,
    cost_sen: input.costSen,
    notes: input.notes.trim() || null,
    shipped_at: shipped ? new Date().toISOString() : null,
    delivered_at: input.status === "delivered" ? new Date().toISOString() : null,
  };

  const { error } = input.id
    ? await db.from("shipments").update(row).eq("id", input.id)
    : await db.from("shipments").insert(row);
  if (error) return { error: error.message };

  // Dispatching a parcel and fulfilling the order are one action in practice.
  if (shipped && order.status === "paid") {
    await db.from("orders").update({ status: "fulfilled" }).eq("id", order.id as string);
  }

  await logAudit(db, {
    action: input.id ? "shipment.updated" : "shipment.created",
    entityType: "order",
    entityId: input.reference,
    summary:
      `Shipment ${input.id ? "updated" : "added"} for ${input.reference}` +
      `${input.trackingNo.trim() ? ` — ${input.courier} ${input.trackingNo.trim()}` : ""}` +
      ` (${input.status})`,
    meta: { courier: input.courier, trackingNo: input.trackingNo, status: input.status },
  });

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${input.reference}`);
  revalidatePath("/account");
  return { ok: true };
}

export type CourierRate = {
  serviceId: string; serviceName: string; courierName: string; amountSen: number;
};

/*
  Live courier rates for the booking picker. Staff-only: this spends the
  merchant's API quota and reveals Kalima's own cost prices.
*/
export async function fetchCourierRates(
  reference: string,
): Promise<{ rates: CourierRate[]; weightGrams: number } | { error: string }> {
  try { await assertStaff(); } catch { return { error: "Not authorized." }; }

  const { options, weightGrams, unavailable } = await getRatesForOrder(reference);
  if (unavailable) return { error: unavailable };
  return {
    weightGrams,
    rates: options.map((o) => ({
      serviceId: o.serviceId, serviceName: o.serviceName,
      courierName: o.courierName, amountSen: o.amountSen,
    })),
  };
}

/*
  Books a parcel with EasyParcel and writes the AWB back.

  This spends real money from the merchant wallet, so it carries the two guards
  the reference integration documents as missing:

  1. IDEMPOTENCY. The shipment row is claimed with a conditional update
     (pending -> booking) BEFORE the API call. A second concurrent click loses
     the race and stops, instead of booking a second parcel and debiting the
     wallet twice.
  2. WALLET PRE-CHECK. An empty wallet produces "top up", not a raw upstream
     error, and costs nothing.

  If the API call fails the claim is released so the parcel can be retried.
*/
export async function bookShipment(input: {
  reference: string;
  shipmentId: string;
  serviceId: string;
  collectionDate?: string;
}): Promise<ActionResult & { trackingNo?: string }> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }


  const order = await getOrder(input.reference);
  if (!order) return { error: "Order not found." };

  const cfg = await getShippingConfig();
  const { weightGrams, options, unavailable } = await getRatesForOrder(input.reference);
  if (unavailable) return { error: unavailable };

  const chosen = options.find((o) => o.serviceId === input.serviceId);
  if (!chosen) return { error: "That courier option is no longer available — refresh the rates." };

  // (2) Wallet pre-check: cheaper to ask than to fail mid-booking.
  try {
    const client = await easyparcelClient();
    const balanceSen = await client.getWalletBalanceSen();
    if (balanceSen < chosen.amountSen) {
      return {
        error: `EasyParcel wallet is short — balance ${(balanceSen / 100).toFixed(2)} MYR, ` +
          `this booking costs ${(chosen.amountSen / 100).toFixed(2)} MYR. Top up and try again.`,
      };
    }
  } catch {
    // A wallet endpoint failure must not block a booking that would succeed.
  }

  // (1) Claim the row first. Only one caller can move pending -> booking.
  const { data: claimed, error: claimErr } = await db
    .from("shipments")
    .update({ status: "booked", provider: "easyparcel" })
    .eq("id", input.shipmentId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (claimErr) return { error: claimErr.message };
  if (!claimed) return { error: "This parcel is already booked or is being booked right now." };

  const release = async (msg: string): Promise<ActionResult> => {
    await db.from("shipments")
      .update({ status: "pending", provider: "manual" })
      .eq("id", input.shipmentId);
    return { error: msg };
  };

  try {
    const client = await easyparcelClient();
    const result = await client.submitOrder({
      reference: order.reference,
      serviceId: input.serviceId,
      collectionDate: input.collectionDate,
      sender: senderFrom(cfg),
      receiver: receiverFrom(order.shippingAddress ?? {}, order.phone),
      totalWeightKg: Math.max(weightGrams / 1000, 0.5),
      parcelValue: order.totalSen / 100,
      content: order.items.map((i) => `${i.productName} x${i.qty}`).join(", ").slice(0, 200),
    });

    await db.from("shipments").update({
      provider: "easyparcel",
      provider_ref: result.shipmentId,
      courier: result.courierName ?? chosen.courierName,
      tracking_no: result.trackingNo,
      cost_sen: result.priceSen || chosen.amountSen,
      weight_grams: weightGrams,
      status: "booked",
      shipped_at: new Date().toISOString(),
    }).eq("id", input.shipmentId);

    if (order.status === "paid") {
      await db.from("orders").update({ status: "fulfilled" }).eq("reference", input.reference);
    }

    await logAudit(db, {
      action: "shipment.booked",
      entityType: "order",
      entityId: input.reference,
      summary:
        `Booked ${result.courierName ?? chosen.courierName} for ${input.reference}` +
        `${result.trackingNo ? ` — AWB ${result.trackingNo}` : ""}` +
        ` (${((result.priceSen || chosen.amountSen) / 100).toFixed(2)} MYR)`,
      meta: { shipmentId: result.shipmentId, serviceId: input.serviceId, costSen: result.priceSen },
    });

    revalidatePath(`/admin/orders/${input.reference}`);
    revalidatePath("/admin/orders");
    revalidatePath("/account");
    return { ok: true, trackingNo: result.trackingNo ?? undefined };
  } catch (e) {
    return await release(
      e instanceof Error ? e.message : "EasyParcel booking failed — the parcel was not booked.",
    );
  }
}

export async function deleteShipment(id: string, reference: string): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const { error } = await db.from("shipments").delete().eq("id", id);
  if (error) return { error: error.message };

  await logAudit(db, {
    action: "shipment.deleted", entityType: "order", entityId: reference,
    summary: `Shipment removed from ${reference}`, meta: { shipmentId: id },
  });

  revalidatePath(`/admin/orders/${reference}`);
  revalidatePath("/account");
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

/*
  A sale price is a promise: the storefront strikes the list price through and
  shows this instead. So it has to be a real reduction. The same rule is a
  check constraint on the table — this exists to say it in English before the
  database says it in Postgres.
*/
function checkSalePrice(saleSen: number | null, priceSen: number): string | null {
  if (saleSen === null) return null;
  if (!Number.isInteger(saleSen) || saleSen < 0) return "Enter a valid sale price.";
  if (saleSen >= priceSen) return "The sale price must be below the normal price.";
  return null;
}

export type ProductInput = {
  id?: string;
  name: string;
  slug: string;
  description: string;
  fabric: string;
  category: "women" | "men" | "accessories";
  priceSen: number;
  /** Null clears the sale. Must be below priceSen — the database enforces it too. */
  salePriceSen: number | null;
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
  const saleError = checkSalePrice(input.salePriceSen, input.priceSen);
  if (saleError) return { error: saleError };

  const row = {
    name, slug,
    description: input.description.trim() || null,
    fabric: input.fabric.trim() || null,
    category: input.category,
    price_sen: input.priceSen,
    sale_price_sen: input.salePriceSen,
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
    category: CsvCategory; priceSen: number;
    /* undefined = the file has no sale_price_rm column, so leave any existing
       sale alone; null = the column is there and blank, meaning "no sale". */
    salePriceSen: number | null | undefined;
    bestSeller: boolean; newArrival: boolean;
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
    /*
      A file exported before sale prices existed has no such column at all.
      Treating that as "clear the sale" would wipe a live promotion on the
      first round-trip, so an absent column means "leave it as it is" — only a
      present-but-blank cell clears.
    */
    let salePriceSen: number | null | undefined;
    if (r.sale_price_rm !== undefined) {
      salePriceSen = rmToSen(r.sale_price_rm);
      if (Number.isNaN(salePriceSen)) {
        errors.push({ row, message: "sale_price_rm must be a number or blank." });
        return;
      }
      if (salePriceSen !== null && salePriceSen >= priceSen) {
        errors.push({ row, message: "sale_price_rm must be below price_rm." });
        return;
      }
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
      category, priceSen, salePriceSen, bestSeller: parseBool(r.best_seller ?? "", false),
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
      // Omitted entirely when the file carries no sale_price_rm column.
      ...(head.salePriceSen !== undefined ? { sale_price_sen: head.salePriceSen } : {}),
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

/*
  Repoints an existing image row at a newly uploaded object — the second half
  of re-cropping a photo that is already live.

  It edits the row in place rather than deleting and re-adding, so the image
  keeps its position, alt text and colour scope. Re-adding would send a
  re-cropped hero shot to the back of the queue and quietly promote a different
  photo to the PLP.
*/
export async function replaceProductImage(input: {
  imageId: string; productSlug: string; path: string;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const { data: row, error: readErr } = await db
    .from("product_images").select("storage_path").eq("id", input.imageId).maybeSingle();
  if (readErr) return { error: readErr.message };
  if (!row) return { error: "That image no longer exists." };

  const { data: pub } = db.storage.from(IMAGE_BUCKET).getPublicUrl(input.path);
  if (!pub?.publicUrl) return { error: "Could not resolve the uploaded image." };

  const { error } = await db
    .from("product_images")
    .update({ url: pub.publicUrl, storage_path: input.path })
    .eq("id", input.imageId);
  if (error) return { error: error.message };

  // Only now is the old file unreferenced. Best-effort — a stranded object is
  // cheaper than a row pointing at a file that has been deleted.
  const old = row.storage_path as string | null;
  if (old && old !== input.path) {
    await db.storage.from(IMAGE_BUCKET).remove([old]).catch(() => {});
  }

  await logAudit(db, {
    action: "image.replaced", entityType: "product", entityId: input.productSlug,
    summary: `Image re-cropped on ${input.productSlug}`,
    meta: { imageId: input.imageId, path: input.path, replaced: old },
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

/* ------------------------------------------------------------------------
   Phase 8 — marketplace sync
   ------------------------------------------------------------------------ */

/*
  Mapping a variant to a marketplace listing.

  The external ids are typed or imported, never guessed. Both uniqueness
  directions are enforced in the database (one listing per variant per channel,
  one variant per listing), so a duplicate surfaces as a friendly message here
  rather than a constraint error in the UI.
*/
export async function mapListing(input: {
  variantId: string;
  channel: string;
  externalItemId: string;
  externalModelId?: string;
  safetyBuffer?: number;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  if (!isChannel(input.channel) || !channelDoes(input.channel, "stock_sync")) {
    return { error: "That channel does not carry stock." };
  }
  const itemId = input.externalItemId.trim();
  if (!itemId) return { error: "The marketplace item id is required." };

  const modelId = input.externalModelId?.trim() || null;
  const buffer = Math.max(0, Math.trunc(input.safetyBuffer ?? 0));

  const { data: variant } = await db
    .from("product_variants").select("sku").eq("id", input.variantId).maybeSingle();
  if (!variant) return { error: "That variant no longer exists." };

  const { error } = await db.from("channel_listings").upsert(
    {
      channel: input.channel,
      variant_id: input.variantId,
      external_item_id: itemId,
      external_model_id: modelId,
      external_sku: variant.sku,
      safety_buffer: buffer,
    },
    { onConflict: "channel,variant_id" },
  );
  if (error) {
    return {
      error: error.code === "23505"
        ? "That marketplace listing is already mapped to a different variant."
        : error.message,
    };
  }

  await logAudit(db, {
    action: "channel_listing.mapped", entityType: "product_variant", entityId: input.variantId,
    summary: `${variant.sku} mapped to ${input.channel} listing ${itemId}${modelId ? `/${modelId}` : ""}`,
    meta: { channel: input.channel, external_item_id: itemId, external_model_id: modelId },
  });
  revalidatePath("/admin/sync");
  return { ok: true };
}

export async function unmapListing(listingId: string): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const { data: listing } = await db
    .from("channel_listings").select("channel, external_item_id, external_sku").eq("id", listingId).maybeSingle();

  const { error } = await db.from("channel_listings").delete().eq("id", listingId);
  if (error) return { error: error.message };

  await logAudit(db, {
    action: "channel_listing.unmapped", entityType: "channel_listing", entityId: listingId,
    summary: `${listing?.external_sku ?? "listing"} unmapped from ${listing?.channel ?? "channel"}`,
  });
  revalidatePath("/admin/sync");
  return { ok: true };
}

/*
  Safety buffer and the per-listing sync switch.

  Changing the buffer changes what the marketplace is allowed to sell, so it
  queues a resync rather than waiting for the next stock movement — otherwise a
  buffer raised in response to an oversell would not take effect until something
  else happened to move.
*/
export async function updateListing(input: {
  listingId: string;
  safetyBuffer?: number;
  syncEnabled?: boolean;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const patch: Record<string, unknown> = {};
  if (input.safetyBuffer !== undefined) {
    patch.safety_buffer = Math.max(0, Math.trunc(input.safetyBuffer));
  }
  if (input.syncEnabled !== undefined) patch.sync_enabled = input.syncEnabled;
  if (Object.keys(patch).length === 0) return { ok: true };

  const { data: listing, error } = await db
    .from("channel_listings").update(patch).eq("id", input.listingId)
    .select("channel, external_sku, safety_buffer, sync_enabled").maybeSingle();
  if (error) return { error: error.message };
  if (!listing) return { error: "That mapping no longer exists." };

  if (listing.sync_enabled) {
    await db.from("channel_sync_jobs").upsert(
      { channel: listing.channel, kind: "push_stock", listing_id: input.listingId },
      { onConflict: "listing_id", ignoreDuplicates: true },
    );
  }

  await logAudit(db, {
    action: "channel_listing.updated", entityType: "channel_listing", entityId: input.listingId,
    summary: `${listing.external_sku ?? "listing"} on ${listing.channel}: buffer ${listing.safety_buffer}, sync ${listing.sync_enabled ? "on" : "off"}`,
    meta: patch,
  });
  revalidatePath("/admin/sync");
  return { ok: true };
}

/*
  Bulk mapping from a listing export.

  This is the path that works TODAY, with no API access: the client exports
  their listings from the Shopee or TikTok seller centre, and we match each row
  to a variant by SKU. It is also how mapping will be seeded once the APIs do
  arrive, because a seller centre export is still the fastest way to map a few
  hundred listings.

  Matches on SKU only. Fuzzy matching on product name would guess, and a wrong
  guess here silently points a marketplace listing at the wrong variant — every
  future stock push would then be wrong in both directions.
*/
export async function importListingCsv(
  channel: string,
  csv: string,
): Promise<ActionResult & { mapped?: number; skipped?: number; problems?: string[] }> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  if (!isChannel(channel) || !channelDoes(channel, "stock_sync")) {
    return { error: "That channel does not carry stock." };
  }

  let records: Record<string, string>[];
  try {
    records = parseCsvRecords(csv);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not read that CSV." };
  }
  if (records.length === 0) return { error: "That file has no rows." };

  const first = records[0];
  const hasColumns = "sku" in first && "external_item_id" in first;
  if (!hasColumns) {
    return { error: "The file needs at least the columns: sku, external_item_id (external_model_id optional)." };
  }

  const { data: variants } = await db.from("product_variants").select("id, sku");
  const bySku = new Map(((variants ?? []) as { id: string; sku: string }[]).map((v) => [v.sku.trim().toLowerCase(), v.id]));

  const rows: Record<string, unknown>[] = [];
  const problems: string[] = [];
  let skipped = 0;

  records.forEach((r, i) => {
    const line = i + 2; // header is line 1
    const sku = (r.sku ?? "").trim();
    const itemId = (r.external_item_id ?? "").trim();
    if (!sku || !itemId) { skipped++; problems.push(`Line ${line}: missing sku or external_item_id`); return; }

    const variantId = bySku.get(sku.toLowerCase());
    if (!variantId) { skipped++; problems.push(`Line ${line}: no variant with SKU "${sku}"`); return; }

    rows.push({
      channel,
      variant_id: variantId,
      external_item_id: itemId,
      external_model_id: (r.external_model_id ?? "").trim() || null,
      external_sku: sku,
    });
  });

  if (rows.length === 0) {
    return { error: `Nothing could be mapped. ${problems.slice(0, 5).join("; ")}` };
  }

  const { error } = await db.from("channel_listings").upsert(rows, { onConflict: "channel,variant_id" });
  if (error) return { error: error.message };

  await logAudit(db, {
    action: "channel_listing.imported", entityType: "channel", entityId: channel,
    summary: `Imported ${rows.length} ${channel} listing mapping(s)${skipped ? `, ${skipped} skipped` : ""}`,
    meta: { mapped: rows.length, skipped },
  });
  revalidatePath("/admin/sync");
  return { ok: true, mapped: rows.length, skipped, problems: problems.slice(0, 10) };
}

/*
  Queues a resync of every mapped listing.

  Goes through the debounced queue rather than pushing directly, so pressing it
  during a busy period cannot stampede a marketplace's rate limit.
*/
export async function resyncChannel(channel?: string): Promise<ActionResult & { queued?: number }> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const target = channel && isChannel(channel) ? channel : undefined;
  try {
    const queued = await enqueueFullResync(target);
    await logAudit(db, {
      action: "channel_sync.resync_requested", entityType: "channel", entityId: target ?? "all",
      summary: `Queued a resync of ${queued} listing(s)${target ? ` on ${target}` : ""}`,
    });
    revalidatePath("/admin/sync");
    return { ok: true, queued };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not queue the resync." };
  }
}

export async function disconnectChannelAction(channel: string): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }
  if (!isChannel(channel)) return { error: "Unknown channel." };

  try {
    await disconnectChannel(channel);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not disconnect." };
  }
  await logAudit(db, {
    action: "channel.disconnected", entityType: "channel", entityId: channel,
    summary: `${channel} disconnected`,
  });
  revalidatePath("/admin/sync");
  return { ok: true };
}

/* ------------------------------------------------------------------------
   Phase 9 — unified inbox
   ------------------------------------------------------------------------ */

/*
  Send a reply.

  Deliberately thin: every policy decision — is the window open, is the channel
  connected, what happens when the platform rejects it — lives in
  lib/channels/inbox.ts, so it cannot differ between this action and any other
  caller added later. This layer does authorisation and revalidation only.
*/
export async function sendInboxReply(
  conversationId: string,
  body: string,
): Promise<ActionResult> {
  let current;
  try {
    await assertStaff();
    current = await getCurrentUser();
  } catch {
    return { error: "Not authorized." };
  }
  if (!current) return { error: "Not authorized." };

  const res = await sendReply({ conversationId, body, staffId: current.user.id });
  if ("error" in res) return { error: res.error };

  revalidatePath("/admin/inbox");
  return { ok: true };
}

export async function addInboxNote(
  conversationId: string,
  body: string,
): Promise<ActionResult> {
  let current;
  try {
    await assertStaff();
    current = await getCurrentUser();
  } catch {
    return { error: "Not authorized." };
  }
  if (!current) return { error: "Not authorized." };

  const res = await addNote({ conversationId, body, staffId: current.user.id });
  if ("error" in res) return { error: res.error };

  revalidatePath("/admin/inbox");
  return { ok: true };
}

/*
  No markInboxRead action. Reading is decided by what the server renders
  (admin/inbox/page.tsx), so there is nothing for the client to ask for — and
  every exported action here is a reachable endpoint, so an unused one is
  surface with no purpose.
*/

/*
  Assignment and status.

  Assigning to nobody is expressed as null rather than a sentinel, so "unassigned"
  and "assigned to a deleted user" are the same state — which they are, since the
  column is ON DELETE SET NULL.
*/
export async function updateConversation(input: {
  conversationId: string;
  assignedTo?: string | null;
  status?: "open" | "snoozed" | "closed";
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const patch: Record<string, unknown> = {};
  if (input.assignedTo !== undefined) patch.assigned_to = input.assignedTo || null;
  if (input.status !== undefined) patch.status = input.status;
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await db.from("conversations").update(patch).eq("id", input.conversationId);
  if (error) return { error: error.message };

  await logAudit(db, {
    action: "conversation.updated", entityType: "conversation", entityId: input.conversationId,
    summary: `Conversation ${input.status ? `set to ${input.status}` : "reassigned"}`,
    meta: patch,
  });
  revalidatePath("/admin/inbox");
  return { ok: true };
}

/*
  Connects a Meta messaging channel — WhatsApp, Instagram or Facebook Page.

  Unlike the marketplaces there is no OAuth round trip: all three take a
  permanent token from the environment, so there is nothing to exchange. What
  this does instead is ask Meta to describe the configured id using that token,
  and only record the connection if Meta answers. "Connected" on the admin card
  therefore means a real round trip succeeded, not that someone pasted a value
  into an env file.

  One action for all three rather than one per channel: the shape is identical
  and the only difference is which call verifies. Instagram and Facebook were
  left out when this was written for WhatsApp alone, which left their rows
  reading "Not connected" forever with no way to change it — the same class of
  lie as the getChannelCards filter.
*/
export async function connectMetaChannel(
  channel: MetaMessagingChannel,
): Promise<ActionResult & { name?: string | null }> {
  let db;
  let current;
  try {
    db = await assertStaff();
    current = await getCurrentUser();
  } catch {
    return { error: "Not authorized." };
  }

  const label = CHANNEL_LABEL[channel];

  try {
    const info =
      channel === "whatsapp"
        ? await verifyWhatsAppCredentials().then((w) => ({
            id: w.phoneNumberId,
            name: w.verifiedName ?? w.displayPhoneNumber,
          }))
        : await verifyMetaMessagingCredentials(channel);

    await markConnectedViaEnvironment(channel, {
      shopName: info.name,
      externalShopId: info.id,
      connectedBy: current?.user.id ?? null,
    });
    await logAudit(db, {
      action: "channel.connected", entityType: "channel", entityId: channel,
      summary: `${label} connected (${info.name ?? info.id})`,
    });
    revalidatePath("/admin/inbox");
    return { ok: true, name: info.name };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : `Could not verify the ${label} credentials.`,
    };
  }
}
