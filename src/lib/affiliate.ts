import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

/*
  Affiliate read models.

  Balances are derived from affiliate_referrals rather than stored on the
  affiliate row: a running total that can drift out of step with the rows it
  summarises is how people get paid twice. The referral table is the ledger.
*/

function db() {
  const client = createAdminClient();
  if (!client) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return client;
}

export type AffiliateStatus = "pending" | "approved" | "suspended";
export type ReferralStatus = "pending" | "approved" | "paid" | "clawed_back";

export type Affiliate = {
  id: string;
  userId: string | null;
  email: string;
  name: string;
  slug: string;
  discountCode: string | null;
  commissionBps: number;
  status: AffiliateStatus;
  payoutNote: string | null;
  createdAt: string;
};

export type Referral = {
  id: string;
  orderReference: string | null;
  baseSen: number;
  commissionSen: number;
  source: string;
  status: ReferralStatus;
  holdUntil: string;
  createdAt: string;
};

export type AffiliateStats = {
  clicks: number;
  orders: number;
  /** Earned but still inside the return window. */
  pendingSen: number;
  /** Past the hold period, payable. */
  payableSen: number;
  paidSen: number;
  clawedBackSen: number;
};

function mapAffiliate(r: Record<string, unknown>): Affiliate {
  return {
    id: r.id as string,
    userId: (r.user_id as string | null) ?? null,
    email: r.email as string,
    name: r.name as string,
    slug: r.slug as string,
    discountCode: (r.discount_code as string | null) ?? null,
    commissionBps: r.commission_bps as number,
    status: r.status as AffiliateStatus,
    payoutNote: (r.payout_note as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

/** The signed-in user's affiliate record, or null if they haven't applied. */
export async function getMyAffiliate(): Promise<Affiliate | null> {
  const current = await getCurrentUser();
  if (!current) return null;

  // Match on user_id, falling back to email so an application made before the
  // account existed still resolves.
  const { data } = await db()
    .from("affiliates")
    .select("*")
    .or(`user_id.eq.${current.user.id},email.eq.${current.user.email ?? ""}`)
    .maybeSingle();
  return data ? mapAffiliate(data) : null;
}

export async function getAffiliateStats(affiliateId: string): Promise<AffiliateStats> {
  const client = db();
  const [{ count: clicks }, { data: refs }] = await Promise.all([
    client.from("affiliate_clicks").select("id", { count: "exact", head: true })
      .eq("affiliate_id", affiliateId),
    client.from("affiliate_referrals")
      .select("commission_sen, status, hold_until")
      .eq("affiliate_id", affiliateId),
  ]);

  const now = Date.now();
  const stats: AffiliateStats = {
    clicks: clicks ?? 0, orders: 0,
    pendingSen: 0, payableSen: 0, paidSen: 0, clawedBackSen: 0,
  };

  for (const r of refs ?? []) {
    const amount = r.commission_sen as number;
    const status = r.status as ReferralStatus;
    if (status !== "clawed_back") stats.orders += 1;

    if (status === "paid") stats.paidSen += amount;
    else if (status === "clawed_back") stats.clawedBackSen += amount;
    else if (new Date(r.hold_until as string).getTime() > now) stats.pendingSen += amount;
    else stats.payableSen += amount;
  }
  return stats;
}

export async function listReferrals(affiliateId: string, limit = 50): Promise<Referral[]> {
  const { data, error } = await db()
    .from("affiliate_referrals")
    .select("id, base_sen, commission_sen, source, status, hold_until, created_at, orders(reference)")
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listReferrals failed: ${error.message}`);

  return (data ?? []).map((r) => ({
    id: r.id as string,
    // PostgREST returns an embedded to-one as an object or a single-element
    // array depending on how it infers the relationship — accept both.
    orderReference: (() => {
      const o = r.orders as unknown;
      if (Array.isArray(o)) return (o[0] as { reference?: string } | undefined)?.reference ?? null;
      return (o as { reference?: string } | null)?.reference ?? null;
    })(),
    baseSen: r.base_sen as number,
    commissionSen: r.commission_sen as number,
    source: r.source as string,
    status: r.status as ReferralStatus,
    holdUntil: r.hold_until as string,
    createdAt: r.created_at as string,
  }));
}

export type PayoutRow = {
  id: string; amountSen: number; reference: string | null;
  note: string | null; paidAt: string;
};

export async function listPayouts(affiliateId: string): Promise<PayoutRow[]> {
  const { data, error } = await db()
    .from("affiliate_payouts")
    .select("id, amount_sen, reference, note, paid_at")
    .eq("affiliate_id", affiliateId)
    .order("paid_at", { ascending: false });
  if (error) throw new Error(`listPayouts failed: ${error.message}`);
  return (data ?? []).map((p) => ({
    id: p.id as string, amountSen: p.amount_sen as number,
    reference: p.reference as string | null, note: p.note as string | null,
    paidAt: p.paid_at as string,
  }));
}

/* ---- Admin ------------------------------------------------------------- */

export type AffiliateWithStats = Affiliate & { stats: AffiliateStats };

export async function listAffiliates(): Promise<AffiliateWithStats[]> {
  const { data, error } = await db()
    .from("affiliates")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listAffiliates failed: ${error.message}`);

  const rows = (data ?? []).map(mapAffiliate);
  const stats = await Promise.all(rows.map((a) => getAffiliateStats(a.id)));
  return rows.map((a, i) => ({ ...a, stats: stats[i] }));
}

export async function getAffiliateById(id: string): Promise<Affiliate | null> {
  const { data } = await db().from("affiliates").select("*").eq("id", id).maybeSingle();
  return data ? mapAffiliate(data) : null;
}
