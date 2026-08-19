import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { expireStalePendingOrders } from "@/lib/commerce";
import { checkConnection } from "@/lib/shipping/config";
import { drainDeadLetter } from "@/lib/meta/dead-letter";

/*
  Cancels checkouts that were placed and never paid.

  Nothing in the system expires a pending order, so an abandoned checkout would
  sit `pending` forever — cluttering the order list and, once revenue reporting
  matters, muddying the pending vs. paid picture. This sweep closes them out.

  Safety before tidiness: every candidate is re-checked against the gateway
  first (reconcileOrderPayment). LeanX pushes a callback on SUCCESS ONLY, so a
  lost success callback would otherwise leave a genuinely-paid order looking
  abandoned — and we must never cancel one the customer paid for. Only an order
  the gateway does not confirm as paid is cancelled.

  Nor one it might still accept. An order whose gateway reports the payment as
  still in progress is HELD, not cancelled, and appears as `held` in the report.
  The 30-minute cutoff was sized against LeanX's hosted-bill lifetime; an Atome
  payment stays payable for twelve hours, so the cutoff alone would have closed
  orders a customer could still complete — charging them for something we would
  then refuse to fulfil.

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
  /*
    THE STAFF SESSION IS A POST-ONLY CREDENTIAL.

    A cookie rides along with any cross-site GET the browser is told to make,
    so accepting a session on GET meant an &lt;img src="…/api/orders/expire"&gt; on a
    hostile page ran a cancellation sweep as whichever staff member loaded it.
    Cron keeps its GET because it authenticates with a Bearer header, which no
    third-party page can attach.
  */
  if (!authorised && request.method !== "GET") {
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
    return NextResponse.json({
      ok: true, cutoffMinutes: minutes, ...report,
      shipping: await checkShipping(),
      capi: await retryCapi(),
    });
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

/*
  Rides along on this daily tick to prove the EasyParcel connection still works.

  IT IS HERE BECAUSE THERE IS NOWHERE ELSE. The Hobby plan allows two cron jobs
  and both are spoken for, and this one runs daily at a quiet hour, which is
  exactly the cadence the check wants — see checkConnection for why a day's gap
  is what makes it exercise the token renewal rather than just read a valid one.
  It is an odd lodger in an order-expiry route; a third cron slot is the tidy
  answer if the plan ever allows one.

  DELIBERATELY CANNOT FAIL THE SWEEP. The sweep is this endpoint's job and it
  either cancelled abandoned orders or it did not; folding an unrelated
  courier-integration fault into that verdict would make a working sweep look
  broken, and would eventually be ignored. So the result is reported in the body
  and, when it is bad, written to the audit trail — never thrown.

  Only failures are logged. A daily "still fine" row would bury the back office
  in three hundred and sixty-five entries a year that nobody needs to read, and
  the one that mattered with them.
*/
async function checkShipping() {
  try {
    const result = await checkConnection();

    if (result.status === "failed") {
      console.error("[shipping] daily connection check failed:", result.detail);
      /* Service role, actor null: nobody did this, a machine noticed it. */
      await createAdminClient()?.from("admin_audit_log").insert({
        actor_id: null,
        actor_email: null,
        action: "shipping.connection_check_failed",
        entity_type: "settings",
        entity_id: "shipping",
        summary: "EasyParcel connection check failed — overseas checkout cannot quote",
        meta: { detail: result.detail },
      });
    }

    return result;
  } catch (e) {
    /* The check itself broke, which is not the sweep's problem either. */
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[shipping] daily connection check errored:", detail);
    return { status: "failed" as const, detail, renewed: false };
  }
}

/*
  Retries conversions Meta has not acknowledged, and drops the ones that can no
  longer be sent honestly.

  A second lodger on this cron, for the same reason as the shipping check above:
  the Hobby plan allows two jobs and both are spoken for. Daily is the floor
  rather than the target — most failures are transient and the write-ahead means
  the payload survives until something drains it.

  Cannot fail the sweep, and cannot fail loudly either. A conversion that never
  reaches Meta costs the shop reporting accuracy; a cancellation sweep that
  reports failure costs it a working cron.
*/
async function retryCapi() {
  try {
    return await drainDeadLetter();
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[capi] dead-letter retry errored:", detail);
    return { attempted: 0, sent: 0, expired: 0, failed: 0, error: detail };
  }
}
