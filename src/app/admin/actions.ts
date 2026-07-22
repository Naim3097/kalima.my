"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

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
