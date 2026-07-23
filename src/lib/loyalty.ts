import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

/*
  Kalima Club read models.

  Balance and tier are asked of the database rather than recomputed here, so
  the storefront, the account page and the admin liability report can never
  disagree about what someone is owed.
*/

function db() {
  const client = createAdminClient();
  if (!client) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return client;
}

export type LoyaltyRules = {
  pointsPerRm: number;
  senPerPoint: number;
  minRedeemPoints: number;
  maxRedeemBps: number;
  expiryMonths: number;
  enabled: boolean;
};

export type Tier = {
  name: string;
  minSpendSen: number;
  multiplierBps: number;
  freeShipping: boolean;
};

export type LedgerEntry = {
  id: string;
  type: "earn" | "redeem" | "expire" | "adjust";
  points: number;
  reason: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type ClubSummary = {
  balance: number;
  /** What the balance is worth, in sen. */
  valueSen: number;
  tier: Tier;
  nextTier: Tier | null;
  spend12mSen: number;
  toNextTierSen: number;
  rules: LoyaltyRules;
  entries: LedgerEntry[];
};

export async function getLoyaltyRules(): Promise<LoyaltyRules> {
  const { data, error } = await db().from("loyalty_rules").select("*").eq("id", 1).single();
  if (error) throw new Error(`getLoyaltyRules failed: ${error.message}`);
  return {
    pointsPerRm: data.points_per_rm, senPerPoint: data.sen_per_point,
    minRedeemPoints: data.min_redeem_points, maxRedeemBps: data.max_redeem_bps,
    expiryMonths: data.expiry_months, enabled: data.enabled,
  };
}

export async function getTiers(): Promise<Tier[]> {
  const { data, error } = await db()
    .from("membership_tiers").select("*").order("min_spend_sen");
  if (error) throw new Error(`getTiers failed: ${error.message}`);
  return (data ?? []).map((t) => ({
    name: t.name, minSpendSen: t.min_spend_sen,
    multiplierBps: t.multiplier_bps, freeShipping: t.free_shipping,
  }));
}

/** The signed-in customer's club standing, or null when signed out. */
export async function getMyClub(): Promise<ClubSummary | null> {
  const current = await getCurrentUser();
  if (!current) return null;

  const userId = current.user.id;
  const client = db();

  const [rules, tiers, balanceRes, entriesRes, ordersRes] = await Promise.all([
    getLoyaltyRules(),
    getTiers(),
    client.rpc("loyalty_balance", { p_user_id: userId }),
    client.from("loyalty_ledger")
      .select("id, type, points, reason, expires_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
    client.from("orders")
      .select("total_sen, created_at, status")
      .eq("user_id", userId)
      .in("status", ["paid", "fulfilled", "completed"]),
  ]);

  const balance = (balanceRes.data as number | null) ?? 0;

  const cutoff = Date.now() - 365 * 86_400_000;
  const spend12mSen = (ordersRes.data ?? [])
    .filter((o) => new Date(o.created_at as string).getTime() > cutoff)
    .reduce((sum, o) => sum + (o.total_sen as number), 0);

  // Highest tier the spend qualifies for; the next one up is the goal.
  const sorted = [...tiers].sort((a, b) => a.minSpendSen - b.minSpendSen);
  const tier = [...sorted].reverse().find((t) => t.minSpendSen <= spend12mSen) ?? sorted[0];
  const nextTier = sorted.find((t) => t.minSpendSen > spend12mSen) ?? null;

  return {
    balance,
    valueSen: balance * rules.senPerPoint,
    tier,
    nextTier,
    spend12mSen,
    toNextTierSen: nextTier ? Math.max(nextTier.minSpendSen - spend12mSen, 0) : 0,
    rules,
    entries: (entriesRes.data ?? []).map((e) => ({
      id: e.id as string,
      type: e.type as LedgerEntry["type"],
      points: e.points as number,
      reason: e.reason as string | null,
      expiresAt: e.expires_at as string | null,
      createdAt: e.created_at as string,
    })),
  };
}

/*
  Outstanding points value across all customers — the shop's liability.

  Computed from the ledger for the same reason balances are: a stored figure
  would understate what is actually owed the moment anything drifts.
*/
export async function getLoyaltyLiability(): Promise<{
  outstandingPoints: number; valueSen: number; members: number;
}> {
  const client = db();
  const [{ data: entries }, rules] = await Promise.all([
    client.from("loyalty_ledger").select("user_id, points, expires_at"),
    getLoyaltyRules(),
  ]);

  const now = Date.now();
  const byUser = new Map<string, number>();
  for (const e of entries ?? []) {
    const exp = e.expires_at as string | null;
    if (exp && new Date(exp).getTime() <= now) continue;
    const key = e.user_id as string;
    byUser.set(key, (byUser.get(key) ?? 0) + (e.points as number));
  }

  // A negative balance is not an asset — floor each member at zero so the
  // liability is not quietly reduced by someone who over-refunded.
  let outstanding = 0;
  let members = 0;
  for (const total of byUser.values()) {
    if (total > 0) { outstanding += total; members += 1; }
  }

  return { outstandingPoints: outstanding, valueSen: outstanding * rules.senPerPoint, members };
}
