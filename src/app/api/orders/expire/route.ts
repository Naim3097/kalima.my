import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { expireStalePendingOrders } from "@/lib/commerce";

/*
  Cancels checkouts that were placed and never paid.

  Nothing in the system expires a pending order, so an abandoned checkout would
  sit `pending` forever — cluttering the order list and, once revenue reporting
  matters, muddying the pending vs. paid picture. This sweep closes them out.

  Safety before tidiness: every candidate is re-checked against the gateway
  first (reconcileOrderPayment). LeanX pushes a callback on SUCCESS ONLY, so a
  lost success callback would otherwise leave a genuinely-paid order looking
  abandoned — and we must never cancel one the customer paid for. Only an order
  the gateway does not confirm as paid is cancelled. The default 30-minute
  cutoff comfortably exceeds LeanX's hosted-bill lifetime, so no live payment is
  in flight when we act.

  Auth mirrors the sync route: Vercel cron's Bearer CRON_SECRET, or a signed-in
  staff member for a manual sweep. Fails closed when CRON_SECRET is unset.

  CADENCE: the Vercel cron is DAILY (Hobby plan allows one run/day), so on Hobby
  a stale order can linger up to a day before this catches it — harmless, since
  a pending order reserves no stock and the return-page reconcile already gives
  the shopper a definite verdict. For true ~30-minute expiry, run this endpoint
  from an external scheduler with the CRON_SECRET, or move to a plan that allows
  a sub-daily cron expression.
*/
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET ?? "";

function isCron(request: Request): boolean {
  if (!CRON_SECRET) return false; // fail closed
  const presented = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${CRON_SECRET}`;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false; // timingSafeEqual throws on length mismatch
  return crypto.timingSafeEqual(a, b);
}

async function handle(request: Request) {
  let authorised = isCron(request);
  if (!authorised) {
    const current = await getCurrentUser();
    authorised = Boolean(current && isStaff(current.role));
  }
  if (!authorised) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  // ?minutes= lets a manual sweep or a finer external schedule set its own
  // cutoff; clamped so nobody can cancel orders placed seconds ago.
  const param = Number(new URL(request.url).searchParams.get("minutes"));
  const minutes = Number.isFinite(param) && param >= 15 ? Math.floor(param) : 30;

  try {
    const report = await expireStalePendingOrders(minutes);
    return NextResponse.json({ ok: true, cutoffMinutes: minutes, ...report });
  } catch (err) {
    // A 500 is correct here — the caller is our own cron, and a failed sweep
    // should surface as a failed invocation, not a silent success.
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

export const GET = handle; // Vercel cron issues a GET
export const POST = handle; // admin / external scheduler may POST
