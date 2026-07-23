import "server-only";

import { createAdminClient } from "@/lib/supabase/server";

/*
  Audience segmentation.

  Two populations are unioned: account holders who ticked marketing consent, and
  newsletter subscribers who signed up without an account. They are deduped by
  email, because a customer who did both is one person.

  CONSENT IS THE FLOOR, not a filter option. Every query here excludes anyone
  without explicit consent and anyone who has unsubscribed — there is
  deliberately no switch to override that, because PDPA compliance should not be
  one careless checkbox away from a fine.
*/

export type Segment = {
  /** Only customers who have ever paid for an order. */
  buyersOnly?: boolean;
  /** Minimum lifetime spend, in sen. */
  minSpentSen?: number;
  /** Bought within the last N days. */
  activeWithinDays?: number;
  /** Has NOT bought within the last N days (win-back). */
  inactiveForDays?: number;
};

export type Recipient = { email: string; name: string | null };

function admin() {
  const client = createAdminClient();
  if (!client) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return client;
}

/*
  Resolves a segment to a deduped recipient list.

  Deliberately reads and filters in the app rather than pushing everything into
  SQL: the populations here are a small-shop scale (thousands, not millions),
  and keeping the consent rule visible in one readable place is worth more than
  the query optimisation.
*/
export async function resolveAudience(segment: Segment): Promise<Recipient[]> {
  const db = admin();

  // 1. Consenting account holders.
  const { data: profiles, error: pErr } = await db
    .from("profiles")
    .select("id, full_name, marketing_consent")
    .eq("marketing_consent", true);
  if (pErr) throw new Error(`resolveAudience(profiles) failed: ${pErr.message}`);

  // Emails live on auth.users, which PostgREST cannot join — fetch them via the
  // admin auth API and match on id.
  const emailById = new Map<string, string>();
  try {
    const { data: userList } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of userList?.users ?? []) if (u.email) emailById.set(u.id, u.email);
  } catch {
    // Auth listing unavailable — fall back to newsletter subscribers only.
  }

  // 2. Newsletter subscribers who have not opted out.
  const { data: subs, error: sErr } = await db
    .from("newsletter_subscribers")
    .select("email, name, unsubscribed_at")
    .is("unsubscribed_at", null);
  if (sErr) throw new Error(`resolveAudience(subscribers) failed: ${sErr.message}`);

  // 3. Purchase facts, for the behavioural filters.
  const needsOrders =
    segment.buyersOnly || segment.minSpentSen !== undefined ||
    segment.activeWithinDays !== undefined || segment.inactiveForDays !== undefined;

  const spendByEmail = new Map<string, number>();
  const lastOrderByEmail = new Map<string, number>();
  if (needsOrders) {
    const { data: orders, error: oErr } = await db
      .from("orders")
      .select("email, total_sen, created_at, status")
      .in("status", ["paid", "fulfilled", "completed"]);
    if (oErr) throw new Error(`resolveAudience(orders) failed: ${oErr.message}`);
    for (const o of orders ?? []) {
      const key = (o.email as string).toLowerCase();
      spendByEmail.set(key, (spendByEmail.get(key) ?? 0) + (o.total_sen as number));
      const at = new Date(o.created_at as string).getTime();
      lastOrderByEmail.set(key, Math.max(lastOrderByEmail.get(key) ?? 0, at));
    }
  }

  // Union, deduped by lower-cased email.
  const byEmail = new Map<string, Recipient>();
  for (const p of profiles ?? []) {
    const email = emailById.get(p.id as string);
    if (email) byEmail.set(email.toLowerCase(), { email, name: p.full_name as string | null });
  }
  for (const s of subs ?? []) {
    const key = (s.email as string).toLowerCase();
    if (!byEmail.has(key)) {
      byEmail.set(key, { email: s.email as string, name: s.name as string | null });
    }
  }

  // Anyone who opted out is removed even if they also hold a consenting account
  // — the most recent explicit "no" wins.
  const { data: optedOut } = await db
    .from("newsletter_subscribers")
    .select("email")
    .not("unsubscribed_at", "is", null);
  for (const o of optedOut ?? []) byEmail.delete((o.email as string).toLowerCase());

  const now = Date.now();
  const day = 86_400_000;

  return [...byEmail.entries()]
    .filter(([key]) => {
      const spent = spendByEmail.get(key) ?? 0;
      const last = lastOrderByEmail.get(key);

      if (segment.buyersOnly && spent <= 0) return false;
      if (segment.minSpentSen !== undefined && spent < segment.minSpentSen) return false;
      if (segment.activeWithinDays !== undefined) {
        if (!last || now - last > segment.activeWithinDays * day) return false;
      }
      if (segment.inactiveForDays !== undefined) {
        // Never bought counts as inactive — they are exactly who win-back targets.
        if (last && now - last <= segment.inactiveForDays * day) return false;
      }
      return true;
    })
    .map(([, r]) => r)
    .sort((a, b) => a.email.localeCompare(b.email));
}

/** Audience size without materialising it for the UI. */
export async function countAudience(segment: Segment): Promise<number> {
  return (await resolveAudience(segment)).length;
}
