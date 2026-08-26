"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, isStaff, type Role } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { EDITORIAL_SLOTS, type EditorialSlot } from "@/lib/editorial";
import { syncInstagram, type InstagramSyncSummary } from "@/lib/instagram/sync";
import { TRUST_ICON_KEYS } from "@/lib/trust-icons";
import { parseCsvRecords } from "@/lib/csv";
import { getOrder } from "@/lib/admin";
import { awardLoyaltyPoints } from "@/lib/commerce";
import { easyparcelClient, getShippingConfig } from "@/lib/shipping/config";
import { connectionProblem, getRatesForOrder, receiverFrom, senderFrom } from "@/lib/shipping/rates";
import { parcelSizeFor } from "@/lib/shipping/countries";
import { disconnectChannel, markConnectedViaEnvironment } from "@/lib/channels/tokens";
import { verifyMetaMessagingCredentials, verifyWhatsAppCredentials } from "@/lib/channels/meta";
import { enqueueFullResync } from "@/lib/channels/sync";
import { addNote, sendReply, sendTemplateMessage } from "@/lib/channels/inbox";
import type { TemplateBinding } from "@/lib/messaging/whatsapp";
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

/*
  STRICTER THAN assertStaff, AND ONLY FOR GRANTING POWER.

  isStaff() is true for both `staff` and `admin`, which is right for the ninety
  actions that run the shop. It is wrong for the three that decide who is staff:
  guarded by assertStaff, a staff account could call setUserRole(self, "admin")
  — the write goes through the service-role client, which protect_profile_role
  deliberately permits — and could demote a real admin on the way past. The app
  models staff and admin as different privilege levels everywhere else; role
  management is where that distinction has to actually hold.
*/
async function assertAdmin() {
  const current = await getCurrentUser();
  if (!current || current.role !== "admin") throw new Error("Not authorized");
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

  /*
    A card payment is refunded THROUGH Stripe first, because Stripe can — LeanX
    has no refund API, so for FPX this action only records what was moved by
    hand. If Stripe refuses, nothing is recorded: a refund the books show and
    the customer never received is the worse of the two mistakes.
  */
  const { data: paid } = await db
    .from("payments").select("provider, provider_ref")
    .eq("order_id", order.id as string).eq("status", "paid").maybeSingle();
  let stripeRefundId: string | null = null;
  if (paid?.provider === "stripe" && paid.provider_ref) {
    try {
      const { stripeRefund } = await import("@/lib/payments/stripe");
      const full = input.amountSen === (order.total_sen as number);
      stripeRefundId = (await stripeRefund(paid.provider_ref as string, full ? undefined : input.amountSen)).refundId;
    } catch (e) {
      return { error: `Stripe refused the refund: ${e instanceof Error ? e.message : "unknown error"}` };
    }
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
    meta: { amountSen: input.amountSen, restock: input.restock, reason: input.reason, result: result.status, stripeRefundId },
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
/*
  What the customer pays for delivery.

  Two numbers, and the second is the promotion switch the shop asked for: set a
  spend and shipping is free at or above it, set zero and there is no free
  shipping at all. create_order enforces exactly this — see the
  free_shipping_threshold_off_at_zero migration — so the checkout preview and
  the order that gets written cannot disagree.

  Separate from saveSenderSettings because these are the only two settings on
  this screen that touch a customer's total; everything else there is about
  handing a parcel to a courier.
*/
export async function saveShippingPricing(input: {
  shippingWestSen: number;
  shippingEastSen: number;
  freeShippingThresholdSen: number;
  /* 'courier' shows Malaysian shoppers live EasyParcel pickup rates and
     charges the one they pick; 'zone' charges the two rates above. */
  domesticMode: "zone" | "courier";
  /* Comma-separated courier names offered to Malaysian shoppers; blank = all. */
  domesticAllowedCouriers: string;
  /* Same for overseas shoppers; blank = all. */
  internationalAllowedCouriers: string;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const west = Math.round(Number(input.shippingWestSen));
  const east = Math.round(Number(input.shippingEastSen));
  const threshold = Math.round(Number(input.freeShippingThresholdSen));
  const mode = input.domesticMode === "courier" ? "courier" : "zone";
  const parseList = (raw: string) => raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
  const allowed = parseList(input.domesticAllowedCouriers);
  const allowedIntl = parseList(input.internationalAllowedCouriers);

  /* Courier mode with nothing to quote from would leave every Malaysian
     checkout unable to price itself. Refuse the switch rather than the sale. */
  if (mode === "courier") {
    const cfg = await getShippingConfig();
    const problem = connectionProblem(cfg);
    if (problem) return { error: `Courier pricing needs EasyParcel: ${problem}` };
  }

  if (!Number.isFinite(west) || west < 0) return { error: "Enter a Semenanjung rate of RM0 or more." };
  if (!Number.isFinite(east) || east < 0) return { error: "Enter a Sabah & Sarawak rate of RM0 or more." };
  if (!Number.isFinite(threshold) || threshold < 0) {
    return { error: "Enter a free-shipping threshold of RM0 or more, or 0 to turn it off." };
  }

  const { error } = await db.from("store_settings").update({
    shipping_west_sen: west,
    shipping_east_sen: east,
    /* Kept in step with the West rate. Nothing prices from it any more, but a
       stale column is a trap for whoever reads this table next. */
    flat_shipping_sen: west,
    free_shipping_threshold_sen: threshold,
    domestic_shipping_mode: mode,
    domestic_allowed_couriers: allowed,
    international_allowed_couriers: allowedIntl,
  }).eq("id", 1);
  if (error) return { error: error.message };

  await logAudit(db, {
    action: "shipping.pricing_updated", entityType: "settings", entityId: "shipping",
    summary:
      (mode === "courier"
        ? `Shipping — Malaysia pays the courier the customer picks` +
          (allowed.length ? ` (${allowed.join(", ")} only)` : "")
        : `Shipping — Semenanjung RM${(west / 100).toFixed(2)}, ` +
          `Sabah & Sarawak RM${(east / 100).toFixed(2)}`) +
      (threshold > 0 ? `, free above RM${(threshold / 100).toFixed(2)}` : ""),
    meta: {
      shippingWestSen: west, shippingEastSen: east,
      freeShippingThresholdSen: threshold, domesticMode: mode,
      domesticAllowedCouriers: allowed, internationalAllowedCouriers: allowedIntl,
    },
  });

  revalidatePath("/admin/shipping");
  revalidatePath("/admin/settings");
  // The checkout quotes these figures, so the storefront has to see them change.
  revalidateStorefront();
  return { ok: true };
}

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
  /* Defaulted, so every existing caller keeps meaning "email" without change. */
  channel?: "email" | "whatsapp";
  templateName?: string;
  templateLanguage?: string;
  templateVariables?: TemplateBinding[];
}): Promise<ActionResult & { id?: string }> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  if (!input.name.trim()) return { error: "Give the campaign a name." };

  const channel = input.channel ?? "email";

  /*
    The two channels validate differently because they ARE different.

    An email campaign is text we wrote and can check. A WhatsApp campaign is a
    reference to text Meta approved — there is no body to validate, and
    demanding one would mean staff typing a message that is never sent, which is
    worse than no field at all. What must be checked instead is that the
    template exists, is still approved, and takes exactly as many values as the
    campaign binds.
  */
  if (channel === "email" && !input.body.trim()) {
    return { error: "The message body can't be empty." };
  }

  let templateName: string | null = null;
  let templateLanguage: string | null = null;
  let templateVariables: TemplateBinding[] = [];

  if (channel === "whatsapp") {
    if (!input.templateName || !input.templateLanguage) {
      return { error: "Choose an approved template for a WhatsApp broadcast." };
    }

    const { getTemplate } = await import("@/lib/channels/whatsapp-templates");
    const template = await getTemplate(input.templateName, input.templateLanguage);
    if (!template) {
      return { error: "That template is not in the synced list. Press Sync templates and try again." };
    }
    if (template.status !== "APPROVED") {
      return { error: `Meta has this template as ${template.status}, not APPROVED.` };
    }

    templateVariables = input.templateVariables ?? [];
    if (templateVariables.length !== template.bodyVariables) {
      return {
        error: `This template takes ${template.bodyVariables} value${
          template.bodyVariables === 1 ? "" : "s"
        }, and ${templateVariables.length} ${
          templateVariables.length === 1 ? "was" : "were"
        } supplied.`,
      };
    }
    if (
      templateVariables.some(
        (b) => b.source === "literal" && !b.value.trim(),
      )
    ) {
      return { error: "A fixed value in the template is blank." };
    }

    templateName = template.name;
    templateLanguage = template.language;
  }

  const row = {
    name: input.name.trim(),
    subject: input.subject.trim() || input.name.trim(),
    /* NOT NULL on the column, and unused on WhatsApp. The campaign name is the
       honest filler: it is what the admin list already shows for this row. */
    body: channel === "whatsapp" ? (input.body || input.name.trim()) : input.body,
    segment: input.segment,
    channel,
    template_name: templateName,
    template_language: templateLanguage,
    template_variables: templateVariables,
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

  /*
    Which pipeline runs is decided by the ROW, not by the caller. A client that
    could name the channel could ask for the email pipeline on a WhatsApp
    campaign, which would resolve an email audience and mail people who were
    never in this broadcast's audience at all.
  */
  const { data: row } = await db
    .from("campaigns")
    .select("channel")
    .eq("id", campaignId)
    .maybeSingle();
  if (!row) return { error: "That campaign no longer exists." };

  const result =
    row.channel === "whatsapp"
      ? await (await import("@/lib/messaging/whatsapp")).sendWhatsAppCampaign(campaignId)
      : await (await import("@/lib/messaging/send")).sendCampaign(campaignId);
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

/*
  A pending parcel for an order that has none, so booking is one click.

  Booking through EasyParcel needs a `pending` shipment row to claim; the
  general Add-parcel form defaults to `booked` because it exists for parcels
  dropped at a counter with a consignment number in hand. Making staff open
  that form, flip the status and save before they could even see the rates
  was three steps too many for the common case — and the customer has often
  already chosen and paid for the courier.
*/
export async function createPendingParcel(
  reference: string,
): Promise<ActionResult & { shipmentId?: string }> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const { data: order, error: readErr } = await db
    .from("orders").select("id").eq("reference", reference).maybeSingle();
  if (readErr) return { error: readErr.message };
  if (!order) return { error: "Order not found." };

  const { getOrderWeightGrams } = await import("@/lib/admin");
  const weightGrams = await getOrderWeightGrams(reference);

  const { data: row, error } = await db
    .from("shipments")
    .insert({
      order_id: order.id as string,
      provider: "manual",
      status: "pending",
      weight_grams: weightGrams,
      cost_sen: 0,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  await logAudit(db, {
    action: "shipment.created", entityType: "order", entityId: reference,
    summary: `Parcel prepared for EasyParcel booking on ${reference} (pending)`,
    meta: { shipmentId: row.id, weightGrams },
  });

  revalidatePath(`/admin/orders/${reference}`);
  return { ok: true, shipmentId: row.id as string };
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
      receiver: receiverFrom(order.shippingAddress ?? {}, order.phone, order.email),
      totalWeightKg: Math.max(weightGrams / 1000, 0.5),
      /* The box the rate was quoted for. Booking a different one than the one
         priced is how a quote and an invoice drift apart. */
      dimensions: parcelSizeFor(weightGrams),
      parcelValue: order.totalSen / 100,
      content: order.items.map((i) => `${i.productName} x${i.qty}`).join(", ").slice(0, 200),
    });

    /*
      Most couriers issue the AWB a few seconds after submit_orders returns,
      so a short wait here turns "booked, fetch the AWB later" into "booked —
      AWB xxx" for the common case. Three polls, four seconds apart, then give
      up quietly: the Fetch AWB button and the webhook cover the slow ones.
    */
    let trackingNo = result.trackingNo;
    let trackingUrl = result.trackingUrl;
    let labelUrl = result.labelUrl;
    for (let attempt = 0; attempt < 3 && !(trackingNo && labelUrl); attempt++) {
      await new Promise((r) => setTimeout(r, 4000));
      try {
        const details = await client.getShipmentDetails(result.shipmentId);
        trackingNo = details.awbNumber ?? trackingNo;
        trackingUrl = details.trackingUrl ?? trackingUrl;
        labelUrl = details.labelUrl ?? labelUrl;
      } catch {
        /* A read that fails must not undo a booking that succeeded. */
      }
    }

    await db.from("shipments").update({
      provider: "easyparcel",
      provider_ref: result.shipmentId,
      courier: result.courierName ?? chosen.courierName,
      tracking_no: trackingNo,
      tracking_url: trackingUrl,
      label_url: labelUrl,
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
        `${trackingNo ? ` — AWB ${trackingNo}` : ""}` +
        ` (${((result.priceSen || chosen.amountSen) / 100).toFixed(2)} MYR)`,
      meta: { shipmentId: result.shipmentId, serviceId: input.serviceId, costSen: result.priceSen },
    });

    revalidatePath(`/admin/orders/${input.reference}`);
    revalidatePath("/admin/orders");
    revalidatePath("/account");
    return { ok: true, trackingNo: trackingNo ?? undefined };
  } catch (e) {
    return await release(
      e instanceof Error ? e.message : "EasyParcel booking failed — the parcel was not booked.",
    );
  }
}

/*
  Fetches the AWB for a parcel already booked with EasyParcel.

  submit_orders returns before most couriers have issued the airway bill, so a
  fresh booking often has no AWB number and no label. EasyStore hides this
  behind its "generate AWB" button; this is the same move — ask EasyParcel for
  the shipment's current details and keep whatever has been issued since.

  Free and idempotent: it reads state, spends nothing, and can be clicked
  again until the label appears. The AWB-update webhook writes the same
  columns unprompted; this button exists for the packing desk that will not
  wait for a push.
*/
export async function refreshShipmentAwb(input: {
  reference: string;
  shipmentId: string;
}): Promise<ActionResult & { trackingNo?: string; labelUrl?: string }> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const { data: shipment, error: readErr } = await db
    .from("shipments")
    .select("id, provider, provider_ref, tracking_no, label_url")
    .eq("id", input.shipmentId)
    .maybeSingle();
  if (readErr) return { error: readErr.message };
  if (!shipment) return { error: "Shipment not found." };
  if (shipment.provider !== "easyparcel" || !shipment.provider_ref) {
    return { error: "This parcel was not booked through EasyParcel." };
  }

  try {
    const client = await easyparcelClient();
    const details = await client.getShipmentDetails(shipment.provider_ref as string);

    if (!details.awbNumber && !details.labelUrl) {
      return { error: "EasyParcel has not issued the AWB yet — try again in a minute." };
    }

    /* Only write what was issued; never blank a column the courier filled
       earlier because a later read came back thinner. */
    const patch: Record<string, unknown> = {};
    if (details.awbNumber) patch.tracking_no = details.awbNumber;
    if (details.labelUrl) patch.label_url = details.labelUrl;
    if (details.trackingUrl) patch.tracking_url = details.trackingUrl;
    const { error } = await db.from("shipments").update(patch).eq("id", input.shipmentId);
    if (error) return { error: error.message };

    await logAudit(db, {
      action: "shipment.awb_fetched",
      entityType: "order",
      entityId: input.reference,
      summary: `AWB fetched for ${input.reference}` +
        `${details.awbNumber ? ` — ${details.awbNumber}` : ""}`,
      meta: { shipmentId: input.shipmentId, providerRef: shipment.provider_ref },
    });

    revalidatePath(`/admin/orders/${input.reference}`);
    revalidatePath("/account");
    return {
      ok: true,
      trackingNo: details.awbNumber ?? undefined,
      labelUrl: details.labelUrl ?? undefined,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not reach EasyParcel." };
  }
}

/*
  Cancels a parcel booked with EasyParcel, before the courier collects it.

  EasyParcel credits a cancelled booking back to the wallet as long as the
  parcel has not been picked up, which makes this the cheap way to test a
  real booking: book, see the AWB and label arrive, cancel. It is also the
  honest way out when a customer cancels after the label is printed.

  The row is kept, marked cancelled, so the audit trail shows a booking was
  made and undone — deleting it would erase the shipment number EasyParcel
  refunded against. A fulfilled order whose only live parcel this was goes
  back to paid, because nothing is on its way any more.
*/
export async function cancelEasyparcelBooking(input: {
  reference: string;
  shipmentId: string;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const { data: shipment, error: readErr } = await db
    .from("shipments")
    .select("id, order_id, provider, provider_ref, status, tracking_no")
    .eq("id", input.shipmentId)
    .maybeSingle();
  if (readErr) return { error: readErr.message };
  if (!shipment) return { error: "Shipment not found." };
  if (shipment.provider !== "easyparcel" || !shipment.provider_ref) {
    return { error: "This parcel was not booked through EasyParcel." };
  }
  if (!["booked", "in_transit"].includes(shipment.status as string)) {
    return { error: `A ${String(shipment.status).replace("_", " ")} parcel cannot be cancelled.` };
  }

  try {
    const client = await easyparcelClient();
    await client.cancelOrder(shipment.provider_ref as string);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "EasyParcel refused the cancellation." };
  }

  const { error } = await db.from("shipments")
    .update({ status: "cancelled", shipped_at: null })
    .eq("id", input.shipmentId);
  if (error) return { error: error.message };

  /* Only step the order back when no other parcel is still on its way. */
  const { data: live } = await db.from("shipments")
    .select("id")
    .eq("order_id", shipment.order_id as string)
    .in("status", ["booked", "in_transit", "delivered"])
    .limit(1);
  if (!live?.length) {
    await db.from("orders").update({ status: "paid" })
      .eq("reference", input.reference).eq("status", "fulfilled");
  }

  await logAudit(db, {
    action: "shipment.cancelled", entityType: "order", entityId: input.reference,
    summary: `EasyParcel booking cancelled for ${input.reference}` +
      `${shipment.tracking_no ? ` — AWB ${shipment.tracking_no}` : ""}`,
    meta: { shipmentId: input.shipmentId, providerRef: shipment.provider_ref },
  });

  revalidatePath(`/admin/orders/${input.reference}`);
  revalidatePath("/admin/orders");
  revalidatePath("/account");
  return { ok: true };
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
  /** Shows the "Custom sizing" link on this product's page. */
  offersCustomSizing: boolean;
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
    offers_custom_sizing: input.offersCustomSizing,
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

/*
  Bulk edit across selected products.

  One action rather than one per field, because the useful gesture is "these
  nine pieces, 20% off, published" in a single pass. Anything left undefined is
  left alone — the patch is sparse, so a bulk publish cannot silently reset a
  category nobody touched.

  Percentage pricing is computed per product from that product's OWN list
  price, which is why it cannot be a single UPDATE: a flat "20% off" over rows
  at different prices is a different number for each. The rows are read first
  and written individually, and one bad row is reported without abandoning the
  rest — a constraint violation on one product should not undo eight good
  edits the staffer can see happening.
*/
export type BulkProductPatch = {
  published?: boolean;
  bestSeller?: boolean;
  newArrival?: boolean;
  category?: "women" | "men" | "accessories";
  /* Sale: a percentage off each product's list price, one fixed price for all
     of them, or clear it. */
  sale?: { kind: "percent"; percent: number } | { kind: "fixed"; sen: number } | { kind: "clear" };
};

export async function bulkUpdateProducts(
  ids: string[],
  patch: BulkProductPatch,
): Promise<(ActionResult & { updated?: number; failed?: string[] }) | { error: string }> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  if (!ids.length) return { error: "Select at least one product." };
  if (!Object.keys(patch).length) return { error: "Choose something to change." };
  if (patch.sale?.kind === "percent") {
    const pct = patch.sale.percent;
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
      return { error: "The discount must be between 1% and 99%." };
    }
  }
  if (patch.sale?.kind === "fixed" && (!Number.isInteger(patch.sale.sen) || patch.sale.sen < 0)) {
    return { error: "Enter a valid sale price." };
  }

  const { data: rows, error: readErr } = await db
    .from("products").select("id, slug, name, price_sen").in("id", ids);
  if (readErr) return { error: readErr.message };
  if (!rows?.length) return { error: "Those products no longer exist." };

  const base: Record<string, unknown> = {};
  if (patch.published !== undefined) base.published = patch.published;
  if (patch.bestSeller !== undefined) base.best_seller = patch.bestSeller;
  if (patch.newArrival !== undefined) base.new_arrival = patch.newArrival;
  if (patch.category !== undefined) base.category = patch.category;

  let updated = 0;
  const failed: string[] = [];

  for (const row of rows) {
    const values = { ...base };

    if (patch.sale) {
      if (patch.sale.kind === "clear") {
        values.sale_price_sen = null;
      } else {
        const priceSen = row.price_sen as number;
        const sen = patch.sale.kind === "percent"
          ? Math.round((priceSen * (100 - patch.sale.percent)) / 100)
          : patch.sale.sen;
        const problem = checkSalePrice(sen, priceSen);
        if (problem) {
          // Naming the product matters: "one failed" is useless in a bulk edit.
          failed.push(`${row.name}: ${problem.toLowerCase()}`);
          continue;
        }
        values.sale_price_sen = sen;
      }
    }

    const { error } = await db.from("products").update(values).eq("id", row.id);
    if (error) failed.push(`${row.name}: ${error.message}`);
    else {
      updated += 1;
      revalidatePath(`/products/${row.slug}`);
      revalidatePath(`/admin/products/${row.slug}`);
    }
  }

  if (updated) {
    await logAudit(db, {
      action: "product.bulk_updated",
      entityType: "product",
      entityId: null,
      summary: `${updated} product(s) bulk updated (${Object.keys(patch).join(", ")})`,
      meta: { ids, patch, failed },
    });
    revalidateProduct();
  }

  if (!updated) return { error: failed[0] ?? "Nothing was changed." };
  return { ok: true, updated, failed };
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

  /*
    productId decides the folder, so it has to BE an id — unvalidated it is just
    a caller-supplied string, and `../` in it steers the signed upload to a key
    of the caller's choosing elsewhere in the bucket.
  */
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId)) {
    return { error: "Unknown product." };
  }

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

/* ---- Size chart --------------------------------------------------------- */

/*
  The product's size chart. One per product, no colour scope, and it lives on
  the product row rather than in product_images — see the migration note. It
  shares the product-images bucket and the same signed-upload path, so there is
  one storage story rather than two.
*/
export async function setProductSizeChart(input: {
  productId: string; productSlug: string; path: string;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const { data: pub } = db.storage.from(IMAGE_BUCKET).getPublicUrl(input.path);
  if (!pub?.publicUrl) return { error: "Could not resolve the uploaded image." };

  // Read the outgoing chart first so its file can be cleaned up afterwards.
  const { data: row } = await db
    .from("products").select("size_chart_path").eq("id", input.productId).maybeSingle();

  const { error } = await db
    .from("products")
    .update({ size_chart_url: pub.publicUrl, size_chart_path: input.path })
    .eq("id", input.productId);
  if (error) return { error: error.message };

  const old = row?.size_chart_path as string | null | undefined;
  if (old && old !== input.path) {
    await db.storage.from(IMAGE_BUCKET).remove([old]).catch(() => {});
  }

  await logAudit(db, {
    action: "size_chart.set", entityType: "product", entityId: input.productSlug,
    summary: `Size chart ${old ? "replaced" : "added"} on ${input.productSlug}`,
    meta: { path: input.path },
  });

  revalidateProduct(input.productSlug);
  return { ok: true };
}

export async function clearProductSizeChart(
  productId: string, productSlug: string,
): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const { data: row } = await db
    .from("products").select("size_chart_path").eq("id", productId).maybeSingle();

  const { error } = await db
    .from("products")
    .update({ size_chart_url: null, size_chart_path: null })
    .eq("id", productId);
  if (error) return { error: error.message };

  const path = row?.size_chart_path as string | null | undefined;
  if (path) await db.storage.from(IMAGE_BUCKET).remove([path]).catch(() => {});

  await logAudit(db, {
    action: "size_chart.cleared", entityType: "product", entityId: productSlug,
    summary: `Size chart removed from ${productSlug}`, meta: { path },
  });

  revalidateProduct(productSlug);
  return { ok: true };
}

/* ---- Matching add-ons --------------------------------------------------- */

/*
  Links another product as a matching piece on this one's PDP.

  The colourway is PINNED here rather than mirrored from the parent at render
  time — "matching" is a merchandising judgement (a Cherry abaya may pair with
  Black pants), and even a shared colour only mirrors correctly while both
  products spell it identically. Null means "the add-on's first colourway",
  which is the single-colour case.

  The size is not stored at all: it is whatever the shopper picks on the parent.
*/
export async function addProductAddon(input: {
  parentProductId: string;
  parentSlug: string;
  addonProductId: string;
  colorName?: string | null;
  label?: string | null;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  if (input.parentProductId === input.addonProductId) {
    return { error: "A product cannot be its own add-on." };
  }

  /* Append: the highest existing sort_order plus one, so a new link lands at
     the bottom of the list rather than silently tying with an existing row. */
  const { data: last } = await db
    .from("product_addons")
    .select("sort_order")
    .eq("parent_product_id", input.parentProductId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await db.from("product_addons").insert({
    parent_product_id: input.parentProductId,
    addon_product_id: input.addonProductId,
    addon_color_name: input.colorName?.trim() || null,
    label: input.label?.trim() || null,
    sort_order: ((last?.sort_order as number | undefined) ?? -1) + 1,
  });
  /* The pair is uniquely indexed, so a double-click reports plainly rather
     than surfacing a Postgres constraint name. */
  if (error) {
    return {
      error: error.code === "23505"
        ? "That product is already linked as an add-on."
        : error.message,
    };
  }

  await logAudit(db, {
    action: "product_addon.added", entityType: "product", entityId: input.parentSlug,
    summary: `Add-on linked to ${input.parentSlug}`,
    meta: { addon_product_id: input.addonProductId, color: input.colorName ?? null },
  });

  revalidateProduct(input.parentSlug);
  return { ok: true };
}

/** Edits an existing link — colourway, label, or whether it shows at all. */
export async function updateProductAddon(input: {
  id: string;
  parentSlug: string;
  colorName?: string | null;
  label?: string | null;
  active?: boolean;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const patch: Record<string, unknown> = {};
  if (input.colorName !== undefined) patch.addon_color_name = input.colorName?.trim() || null;
  if (input.label !== undefined) patch.label = input.label?.trim() || null;
  if (input.active !== undefined) patch.active = input.active;
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await db.from("product_addons").update(patch).eq("id", input.id);
  if (error) return { error: error.message };

  await logAudit(db, {
    action: "product_addon.updated", entityType: "product", entityId: input.parentSlug,
    summary: `Add-on updated on ${input.parentSlug}`, meta: { id: input.id, ...patch },
  });

  revalidateProduct(input.parentSlug);
  return { ok: true };
}

export async function removeProductAddon(
  id: string, parentSlug: string,
): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const { error } = await db.from("product_addons").delete().eq("id", id);
  if (error) return { error: error.message };

  await logAudit(db, {
    action: "product_addon.removed", entityType: "product", entityId: parentSlug,
    summary: `Add-on removed from ${parentSlug}`, meta: { id },
  });

  revalidateProduct(parentSlug);
  return { ok: true };
}

/** Persists a reordered list — ids in the order they should appear. */
export async function reorderProductAddons(
  ids: string[], parentSlug: string,
): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  for (const [index, id] of ids.entries()) {
    const { error } = await db.from("product_addons").update({ sort_order: index }).eq("id", id);
    if (error) return { error: error.message };
  }

  revalidateProduct(parentSlug);
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

/*
  A homepage Lookbook tile: a product plus one of its colourways.

  Deliberately stores NO image URL. The photograph is resolved from the
  product_images row at render time (getLookbookShots), so a shot cannot outlive
  the colourway it names — which is exactly how the old hardcoded list ended up
  advertising an Anna Top print that no longer existed.
*/
export async function saveLookbookShot(input: {
  id?: string;
  productId: string;
  colorName: string;
  alt: string;
  sortOrder: number;
  active: boolean;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }
  if (!input.productId) return { error: "Choose a product." };
  if (!input.colorName.trim()) return { error: "Choose a colourway." };

  const row = {
    product_id: input.productId,
    color_name: input.colorName.trim(),
    alt: input.alt.trim() || null,
    sort_order: input.sortOrder,
    active: input.active,
  };

  const { error } = input.id
    ? await db.from("lookbook_shots").update(row).eq("id", input.id)
    : await db.from("lookbook_shots").insert(row);

  /* The pair is uniquely indexed, so report the collision plainly rather than
     surfacing a Postgres constraint name to whoever pressed Save. */
  if (error) {
    return {
      error: error.code === "23505"
        ? "That product and colourway is already in the Lookbook."
        : error.message,
    };
  }

  await logAudit(db, {
    action: input.id ? "lookbook_shot.updated" : "lookbook_shot.created",
    entityType: "cms",
    entityId: input.id ?? input.productId,
    summary: `Lookbook shot ${input.id ? "updated" : "added"}: ${input.colorName}`,
    meta: { productId: input.productId, colorName: input.colorName },
  });

  revalidatePath("/admin/cms");
  revalidateStorefront();
  return { ok: true };
}

export async function deleteLookbookShot(id: string): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }
  const { error } = await db.from("lookbook_shots").delete().eq("id", id);
  if (error) return { error: error.message };
  await logAudit(db, {
    action: "lookbook_shot.deleted", entityType: "cms", entityId: id,
    summary: "Lookbook shot removed",
  });
  revalidatePath("/admin/cms");
  revalidateStorefront();
  return { ok: true };
}

/*
  Deletes the object a replaced CMS image used to point at.

  Deliberately narrow. It only ever removes a key WE minted — a `hero/` or
  `editorial/` object in our own bucket — so a row pointing at /public artwork
  or at production's bucket (which staging's copied rows do) is left alone.

  And only when nothing still shows it. Both CMS tables are checked, not just
  the one being edited: a hero slide and an editorial slot can be pointed at the
  same photograph, and sweeping on the strength of one table would blank the
  other. Nothing stops two rows in the SAME table sharing it either.

  Failure is swallowed: an orphaned object costs storage, a thrown error costs
  the editor their save.
*/
async function sweepReplacedCmsImage(
  db: Awaited<ReturnType<typeof assertStaff>>, url: string,
): Promise<void> {
  const marker = `/storage/v1/object/public/${IMAGE_BUCKET}/`;
  const at = url.indexOf(marker);
  if (at === -1) return;

  const path = url.slice(at + marker.length);
  if (!/^(hero|editorial)\//.test(path)) return;

  for (const table of ["hero_slides", "editorial_images"] as const) {
    const { count, error } = await db
      .from(table)
      .select("image", { count: "exact", head: true })
      .eq("image", url);
    // Unreadable is not the same as unreferenced — keep the object.
    if (error || count) return;
  }

  await db.storage.from(IMAGE_BUCKET).remove([path]).catch(() => {});
}

/*
  Signed upload URL for CMS photography — hero slides and the homepage's
  editorial slots. Same shape as createImageUploadUrl: the browser PUTs straight
  to Storage so the bytes never cross a server action, and the token is scoped
  to this one object key.

  Shares the product-images bucket under a per-surface prefix rather than adding
  buckets — same visibility, same size ceiling, same mime allowlist, and no
  second set of policies to drift out of step with the first.

  The folder is a CLOSED SET, not a caller-supplied string: it lands in the
  object path, and an open one is a path the caller chooses.

  The key itself is random. A caller-supplied filename here is the same problem.
*/
const CMS_IMAGE_FOLDERS = new Set(["hero", "editorial"]);

export async function createCmsImageUploadUrl(
  folder: string, contentType: string, sizeBytes: number,
): Promise<{ path: string; token: string; publicUrl: string } | { error: string }> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  if (!CMS_IMAGE_FOLDERS.has(folder)) return { error: "Unknown image slot." };
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) return { error: "Use a JPEG, PNG, WebP or AVIF image." };
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return { error: "That file looks empty." };
  if (sizeBytes > MAX_IMAGE_BYTES) return { error: "Images must be 5 MB or smaller." };

  const path = `${folder}/${crypto.randomUUID()}.${EXT_BY_TYPE[contentType]}`;
  const { data, error } = await db.storage.from(IMAGE_BUCKET).createSignedUploadUrl(path);
  if (error) return { error: error.message };

  const { data: pub } = db.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) return { error: "Could not resolve the upload location." };

  return { path: data.path, token: data.token, publicUrl: pub.publicUrl };
}

export async function saveHeroSlide(input: {
  id?: string; eyebrow: string; title: string; body: string; image: string; focal: string;
  zoom: number;
  primaryLabel: string; primaryHref: string; secondaryLabel: string; secondaryHref: string;
  sortOrder: number; active: boolean;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }
  if (!input.title.trim()) return { error: "Title is required." };
  if (!input.image.trim()) return { error: "Image path is required." };

  // Read before the write: after it, the row no longer knows what it replaced.
  const { data: before } = input.id
    ? await db.from("hero_slides").select("image").eq("id", input.id).maybeSingle()
    : { data: null };

  const row = {
    eyebrow: input.eyebrow.trim() || null,
    title: input.title.trim(),
    body: input.body.trim() || null,
    image: input.image.trim(),
    focal: input.focal.trim() || "center",
    /*
      Clamped rather than rejected: zoom arrives from a slider, and the column
      carries the same 1–3 CHECK. A stray value should reframe the slide, not
      hand whoever pressed Save a constraint violation.
    */
    zoom: Math.min(3, Math.max(1, Number(input.zoom) || 1)),
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

  // Only once the new image is committed — never strand a slide on a dead URL.
  const previous = before?.image as string | undefined;
  if (previous && previous !== row.image) await sweepReplacedCmsImage(db, previous);

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

  const { data: before } = await db.from("hero_slides").select("image").eq("id", id).maybeSingle();

  const { error } = await db.from("hero_slides").delete().eq("id", id);
  if (error) return { error: error.message };

  // The slide is gone, so its upload has nothing left pointing at it.
  if (before?.image) await sweepReplacedCmsImage(db, before.image as string);

  await logAudit(db, {
    action: "hero_slide.deleted", entityType: "cms", entityId: id,
    summary: "Hero slide deleted",
  });
  revalidatePath("/admin/cms");
  revalidateStorefront();
  return { ok: true };
}

/* ---- Sign-up popup ------------------------------------------------------- */

/*
  The offer shown to signed-out visitors.

  Perks arrive as lines of text and are stored as an array of strings — never
  markup, because this copy is rendered into a modal on every storefront page.

  The delay and the dismissal window are clamped to the same range as the
  column CHECKs, so a slip of a keyboard reframes the popup rather than
  bouncing the editor off a constraint they cannot read.

  `enabled` controls the POPUP only. The discount is governed by its amount:
  set it to zero to stop giving money, which is a different decision from
  taking the advertisement down, and both are made on this one screen.
*/
export async function saveSignupPromo(input: {
  enabled: boolean;
  eyebrow: string;
  heading: string;
  body: string;
  perks: string[];
  firstOrderDiscountSen: number;
  ctaLabel: string;
  ctaHref: string;
  delaySeconds: number;
  dismissDays: number;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  if (!input.heading.trim()) return { error: "A heading is required." };

  const ctaHref = input.ctaHref.trim() || "/signup";
  if (!ctaHref.startsWith("/") || ctaHref.startsWith("//")) {
    return { error: "The button must link to a path on this site, starting with /." };
  }

  const { error } = await db.from("signup_promo").update({
    enabled: input.enabled,
    eyebrow: input.eyebrow.trim() || null,
    heading: input.heading.trim(),
    body: input.body.trim() || null,
    perks: input.perks.map((p) => p.trim()).filter(Boolean),
    /* Clamped at zero, which is also the off switch. There is no upper bound to
       impose that is not arbitrary — a shop may legitimately run RM50 off. */
    first_order_discount_sen: Math.max(0, Math.round(Number(input.firstOrderDiscountSen) || 0)),
    cta_label: input.ctaLabel.trim() || "Create my account",
    cta_href: ctaHref,
    delay_seconds: Math.min(120, Math.max(0, Math.round(Number(input.delaySeconds) || 0))),
    dismiss_days: Math.min(365, Math.max(1, Math.round(Number(input.dismissDays) || 1))),
  }).eq("id", 1);
  if (error) return { error: error.message };

  await logAudit(db, {
    action: input.enabled ? "signup_promo.enabled" : "signup_promo.disabled",
    entityType: "cms", entityId: "signup_promo",
    summary: `Sign-up popup ${input.enabled ? "switched on" : "switched off"}`,
    meta: {
      firstOrderDiscountSen: input.firstOrderDiscountSen,
      delaySeconds: input.delaySeconds,
    },
  });

  revalidatePath("/admin/cms");
  revalidateStorefront();
  return { ok: true };
}

/* ---- Footer ------------------------------------------------------------- */

/*
  The footer's fixed text. Company name and registration number are a legal
  identification line, not marketing — blank them and the shopfront stops
  identifying the company behind it — so they are stored trimmed and rendered
  verbatim.
*/
export async function saveFooterText(input: {
  companyName: string; companyRegNo: string; tagline: string; paymentNote: string;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const { error } = await db.from("store_settings").update({
    company_name: input.companyName.trim() || null,
    company_reg_no: input.companyRegNo.trim() || null,
    footer_tagline: input.tagline.trim() || null,
    footer_payment_note: input.paymentNote.trim() || null,
  }).eq("id", 1);
  if (error) return { error: error.message };

  await logAudit(db, {
    action: "footer.text_updated", entityType: "settings", entityId: "footer",
    summary: "Footer text updated",
  });

  revalidatePath("/admin/cms");
  revalidateStorefront();
  return { ok: true };
}

/* One item of the four-across trust strip. */
export async function saveTrustItem(input: {
  id?: string; icon: string; title: string; body: string;
  sortOrder: number; active: boolean;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }
  if (!input.title.trim()) return { error: "A title is required." };

  /* The icon is a KEY into a fixed set, never markup — an unknown one would
     render the fallback, so it is refused here rather than silently changed. */
  if (!TRUST_ICON_KEYS.includes(input.icon as (typeof TRUST_ICON_KEYS)[number])) {
    return { error: "Choose one of the available icons." };
  }

  const row = {
    icon: input.icon,
    title: input.title.trim(),
    body: input.body.trim() || null,
    sort_order: input.sortOrder,
    active: input.active,
  };

  const { error } = input.id
    ? await db.from("footer_trust").update(row).eq("id", input.id)
    : await db.from("footer_trust").insert(row);
  if (error) return { error: error.message };

  await logAudit(db, {
    action: input.id ? "footer.trust_updated" : "footer.trust_created",
    entityType: "settings", entityId: input.id ?? null,
    summary: `Footer trust item ${input.id ? "updated" : "added"}: ${row.title}`,
  });

  revalidatePath("/admin/cms");
  revalidateStorefront();
  return { ok: true };
}

export async function deleteTrustItem(id: string): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }
  const { error } = await db.from("footer_trust").delete().eq("id", id);
  if (error) return { error: error.message };
  await logAudit(db, {
    action: "footer.trust_deleted", entityType: "settings", entityId: id,
    summary: "Footer trust item removed",
  });
  revalidatePath("/admin/cms");
  revalidateStorefront();
  return { ok: true };
}

export async function saveFooterColumn(input: {
  id?: string; heading: string; sortOrder: number;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }
  if (!input.heading.trim()) return { error: "A column heading is required." };

  const row = { heading: input.heading.trim(), sort_order: input.sortOrder };
  const { error } = input.id
    ? await db.from("footer_link_columns").update(row).eq("id", input.id)
    : await db.from("footer_link_columns").insert(row);
  if (error) return { error: error.message };

  await logAudit(db, {
    action: input.id ? "footer.column_updated" : "footer.column_created",
    entityType: "settings", entityId: input.id ?? null,
    summary: `Footer column ${input.id ? "renamed" : "added"}: ${row.heading}`,
  });

  revalidatePath("/admin/cms");
  revalidateStorefront();
  return { ok: true };
}

/* Deleting a column takes its links with it — footer_links cascades. */
export async function deleteFooterColumn(id: string): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }
  const { error } = await db.from("footer_link_columns").delete().eq("id", id);
  if (error) return { error: error.message };
  await logAudit(db, {
    action: "footer.column_deleted", entityType: "settings", entityId: id,
    summary: "Footer column removed, with its links",
  });
  revalidatePath("/admin/cms");
  revalidateStorefront();
  return { ok: true };
}

/*
  One footer link.

  The href must be a SITE-RELATIVE path or an absolute http(s) URL. Anything
  else — `javascript:`, a bare word, a protocol-relative `//host` — is either a
  404 in the footer of every page or a script URL rendered as a link, and
  neither belongs one typo away.
*/
export async function saveFooterLink(input: {
  id?: string; columnId: string; label: string; href: string;
  sortOrder: number; active: boolean;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }
  if (!input.label.trim()) return { error: "A label is required." };

  const href = input.href.trim();
  const relative = href.startsWith("/") && !href.startsWith("//");
  const absolute = /^https?:\/\//i.test(href);
  if (!relative && !absolute) {
    return { error: "Links must start with / for a page on this site, or https:// for another." };
  }

  const row = {
    column_id: input.columnId,
    label: input.label.trim(),
    href,
    sort_order: input.sortOrder,
    active: input.active,
  };

  const { error } = input.id
    ? await db.from("footer_links").update(row).eq("id", input.id)
    : await db.from("footer_links").insert(row);
  if (error) return { error: error.message };

  await logAudit(db, {
    action: input.id ? "footer.link_updated" : "footer.link_created",
    entityType: "settings", entityId: input.id ?? null,
    summary: `Footer link ${input.id ? "updated" : "added"}: ${row.label} → ${row.href}`,
  });

  revalidatePath("/admin/cms");
  revalidateStorefront();
  return { ok: true };
}

export async function deleteFooterLink(id: string): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }
  const { error } = await db.from("footer_links").delete().eq("id", id);
  if (error) return { error: error.message };
  await logAudit(db, {
    action: "footer.link_deleted", entityType: "settings", entityId: id,
    summary: "Footer link removed",
  });
  revalidatePath("/admin/cms");
  revalidateStorefront();
  return { ok: true };
}

/* ---- Instagram ---------------------------------------------------------- */

/*
  Tags a synced Instagram post with a product, or clears the tag.

  The tag is the whole reason this section still feeds the catalogue: tagged
  tiles open the product page, untagged ones open the post on Instagram.
*/
export async function tagInstagramPost(
  postId: string, productId: string | null,
): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const { error } = await db
    .from("instagram_posts")
    .update({ product_id: productId })
    .eq("id", postId);
  if (error) return { error: error.message };

  await logAudit(db, {
    action: productId ? "instagram_post.tagged" : "instagram_post.untagged",
    entityType: "cms", entityId: postId,
    summary: productId ? "Instagram post tagged with a product" : "Instagram post tag cleared",
    meta: { productId },
  });

  revalidatePath("/admin/cms");
  revalidateStorefront();
  return { ok: true };
}

/*
  Keeps a post off the storefront without deleting it — the next sync would only
  fetch it again, so `hidden` is the only durable way to say "not this one".
*/
export async function setInstagramPostHidden(
  postId: string, hidden: boolean,
): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const { error } = await db.from("instagram_posts").update({ hidden }).eq("id", postId);
  if (error) return { error: error.message };

  await logAudit(db, {
    action: hidden ? "instagram_post.hidden" : "instagram_post.shown",
    entityType: "cms", entityId: postId,
    summary: `Instagram post ${hidden ? "hidden from" : "restored to"} the storefront`,
  });

  revalidatePath("/admin/cms");
  revalidateStorefront();
  return { ok: true };
}

/*
  Pulls from Instagram now, rather than waiting for the daily schedule. Same
  job the scheduler runs — this is the manual escape hatch, exactly as the
  marketplace screen's "Sync now" is.
*/
export async function syncInstagramNow(): Promise<
  ActionResult & { summary?: InstagramSyncSummary }
> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  try {
    const summary = await syncInstagram();
    await logAudit(db, {
      action: "instagram.synced", entityType: "cms", entityId: null,
      summary:
        `Instagram sync — ${summary.added} added, ${summary.updated} updated, ` +
        `${summary.pruned} removed`,
      meta: { ...summary },
    });
    revalidatePath("/admin/cms");
    revalidateStorefront();
    return { ok: true, summary };
  } catch (err) {
    /* Meta's own wording reaches the staff member — "(#200) Requires
       instagram_basic" names the fix, "sync failed" does not. */
    return { error: err instanceof Error ? err.message : "Instagram sync failed." };
  }
}

/* ---- Homepage editorial imagery ----------------------------------------- */

/*
  The category tiles and the collection spotlight. One row per SLOT, and the
  slot list is the one in src/lib/editorial.ts — an unknown slot would write a
  row nothing renders, which looks like a save that silently did nothing.

  Upsert rather than insert-or-update: a slot has no row at all until someone
  first changes it (the code default renders in the meantime), so "create" and
  "edit" are the same action from the editor's side.
*/
export async function saveEditorialImage(input: {
  slot: string; image: string; focal: string; zoom: number; alt: string;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  if (!EDITORIAL_SLOTS.includes(input.slot as EditorialSlot)) return { error: "Unknown image slot." };
  if (!input.image.trim()) return { error: "Upload an image, or enter an image path." };

  const { data: before } = await db
    .from("editorial_images").select("image").eq("slot", input.slot).maybeSingle();

  const row = {
    slot: input.slot,
    image: input.image.trim(),
    focal: input.focal.trim() || "center",
    // Clamped, not rejected — same reasoning as the hero slide's zoom.
    zoom: Math.min(3, Math.max(1, Number(input.zoom) || 1)),
    alt: input.alt.trim() || null,
  };

  const { error } = await db.from("editorial_images").upsert(row, { onConflict: "slot" });
  if (error) return { error: error.message };

  const previous = before?.image as string | undefined;
  if (previous && previous !== row.image) await sweepReplacedCmsImage(db, previous);

  await logAudit(db, {
    action: "editorial_image.updated", entityType: "cms", entityId: input.slot,
    summary: `Homepage image updated: ${input.slot}`,
    meta: { focal: row.focal, zoom: row.zoom },
  });

  revalidatePath("/admin/cms");
  revalidateStorefront();
  return { ok: true };
}

/*
  Hands a slot back to the shot the code picks. Deleting the row IS the reset —
  there is no "original" to restore to, because the default was never stored.
*/
export async function resetEditorialImage(slot: string): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }
  if (!EDITORIAL_SLOTS.includes(slot as EditorialSlot)) return { error: "Unknown image slot." };

  const { data: before } = await db
    .from("editorial_images").select("image").eq("slot", slot).maybeSingle();

  const { error } = await db.from("editorial_images").delete().eq("slot", slot);
  if (error) return { error: error.message };

  if (before?.image) await sweepReplacedCmsImage(db, before.image as string);

  await logAudit(db, {
    action: "editorial_image.reset", entityType: "cms", entityId: slot,
    summary: `Homepage image reset to the default: ${slot}`,
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

/*
  A social link is rendered as an outbound href on every page of the shop, so
  it has to be an absolute http(s) URL. A bare handle or a "javascript:" string
  would either 404 against our own domain or be a script sink.
*/
function cleanUrl(value: string): string | null | undefined {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export async function saveSettings(input: {
  storeName: string; storeEmail: string; storePhone: string; currency: string;
  freeShippingThresholdSen: number; flatShippingSen: number; taxRateBps: number;
  socialInstagram: string; socialTiktok: string; socialFacebook: string; socialThreads: string;
  /** WhatsApp contact number — a phone number, not a URL. See below. */
  socialWhatsapp: string;
}): Promise<ActionResult> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  if (!input.storeName.trim()) return { error: "Store name is required." };

  /*
    WhatsApp is deliberately NOT run through cleanUrl with the others: it is a
    phone number. It is stored as typed, so the site can display "+60 12-345
    6789", and stripped to digits only when a wa.me link is built (see
    getContactChannels in lib/cms.ts) because wa.me rejects punctuation.

    Validated as "contains at least one digit" rather than by shape — Malaysian
    and international formats vary too much to pattern-match without rejecting
    something legitimate, and the failure mode of a bad number is a dead link,
    not a security problem.
  */
  const whatsapp = input.socialWhatsapp.trim();
  if (whatsapp && !/\d/.test(whatsapp)) {
    return { error: "The WhatsApp number must contain digits." };
  }

  const socials = {
    social_instagram: cleanUrl(input.socialInstagram),
    social_tiktok: cleanUrl(input.socialTiktok),
    social_facebook: cleanUrl(input.socialFacebook),
    social_threads: cleanUrl(input.socialThreads),
  };
  for (const [key, value] of Object.entries(socials)) {
    if (value === undefined) {
      const label = key.replace("social_", "");
      return { error: `The ${label} link must be a full URL starting with https://` };
    }
  }
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
    social_whatsapp: whatsapp || null,
    ...(socials as Record<string, string | null>),
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
  try { db = await assertAdmin(); } catch { return { error: "Not authorized." }; }

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
  try { db = await assertAdmin(); } catch { return { error: "Not authorized." }; }
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
  Sends an approved WhatsApp template into a conversation.

  A separate action from sendInboxReply rather than a mode flag on it, because
  the two are different acts with different consequences: a reply is free and
  only possible inside the window, a template is billed by Meta, is governed by
  per-category messaging policy, and works when the window is shut. Collapsing
  them into one endpoint with a branch would mean a client that could send a
  template by omitting a field.

  Policy — approval status, variable counts, which channel — lives in
  lib/channels/inbox.ts, next to the free-text rules it has to stay consistent
  with. This layer does authorisation, audit and revalidation.
*/
export async function sendInboxTemplate(input: {
  conversationId: string;
  templateName: string;
  templateLanguage: string;
  variables: string[];
  headerVariables?: string[];
}): Promise<ActionResult> {
  let db;
  let current;
  try {
    db = await assertStaff();
    current = await getCurrentUser();
  } catch {
    return { error: "Not authorized." };
  }
  if (!current) return { error: "Not authorized." };

  const res = await sendTemplateMessage({ ...input, staffId: current.user.id });
  if ("error" in res) return { error: res.error };

  /*
    Audited, unlike a free-text reply. A template send is a billable, policy
    governed message to someone who may not have written to us in days — when a
    customer asks why they received it, this row is the answer.
  */
  await logAudit(db, {
    action: "inbox.template_sent",
    entityType: "conversation",
    entityId: input.conversationId,
    summary: `Template "${input.templateName}" sent`,
    meta: { template: input.templateName, language: input.templateLanguage },
  });

  revalidatePath("/admin/inbox");
  return { ok: true };
}

/*
  Pulls Meta's template registry into the local cache.

  Manual rather than scheduled, deliberately: approval takes minutes to days and
  arrives without warning, so the useful moment to refresh is when someone is
  looking at the screen wondering whether it came through. A cron would either
  poll constantly or still be stale exactly when it mattered.
*/
export async function syncWhatsAppTemplatesNow(): Promise<
  ActionResult & { report?: { total: number; approved: number; removed: number } }
> {
  let db;
  try { db = await assertStaff(); } catch { return { error: "Not authorized." }; }

  const { syncWhatsAppTemplates, templatesBlockedReason } = await import(
    "@/lib/channels/whatsapp-templates"
  );

  const blocked = templatesBlockedReason();
  if (blocked) return { error: blocked };

  try {
    const report = await syncWhatsAppTemplates();
    await logAudit(db, {
      action: "whatsapp.templates_synced",
      entityType: "channel",
      entityId: "whatsapp",
      summary: `${report.total} template${report.total === 1 ? "" : "s"} synced, ${report.approved} approved${
        report.removed ? `, ${report.removed} removed` : ""
      }`,
      meta: { ...report },
    });
    revalidatePath("/admin/inbox");
    revalidatePath("/admin/campaigns");
    return { ok: true, report };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not sync templates." };
  }
}

/*
  WhatsApp audience size and a rendered sample, for the broadcast composer.

  The twin of previewAudience, and separate for the same reason the pipelines
  are: it counts a different population by a different key, and it renders the
  template rather than a body we hold.
*/
export async function previewWhatsAppBroadcast(input: {
  templateName: string;
  templateLanguage: string;
  bindings: TemplateBinding[];
  segment: SegmentInput;
}): Promise<{ count: number; samples: { phone: string; body: string }[] } | { error: string }> {
  try { await assertStaff(); } catch { return { error: "Not authorized." }; }
  try {
    const { previewWhatsAppCampaign } = await import("@/lib/messaging/whatsapp");
    return await previewWhatsAppCampaign({
      templateName: input.templateName,
      templateLanguage: input.templateLanguage,
      bindings: input.bindings,
      segment: input.segment,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not preview the broadcast." };
  }
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
