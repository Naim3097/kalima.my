import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { drain } from "@/lib/channels/sync";

/*
  Drains the marketplace sync queue. Invoked by the Vercel cron in vercel.json,
  and by staff from the admin screen.

  TWO LANES, because the work has two very different costs.

    FAST (default, no query string) — drain the push queue and poll each
    connected channel for new orders. Cheap: a handful of API calls. Runs every
    5 minutes from .github/workflows/channel-sync.yml.

    DEEP (?reconcile=1) — everything the fast lane does, plus a reconcile sweep
    that reads back each listing's quantity from the marketplace and queues a
    correction where it disagrees with ours. One API read PER LISTING, so it is
    nightly, not per-minute. This is the Vercel cron in vercel.json.

  WHY THE FAST LANE IS NOT A VERCEL CRON. The project is on Vercel's Hobby
  plan, which permits at most one cron run per day; a sub-daily expression is
  rejected and fails the BUILD, not just the cron (verified against the team's
  billing plan, August 2026). So the 5-minute lane is driven externally through
  the CRON_SECRET below. If this ever moves to Pro, delete the workflow and add
  a five-minute cron entry pointing at this path with no query string — nothing
  in this file needs to change.

  Daily alone would be fine while no marketplace is connected — the drain is a
  no-op with no ready channels. It is NOT fine once Shopee or TikTok go live:
  stock would lag by up to 24 hours, which is how you oversell. The admin's
  "Sync now" and "Re-sync all" work regardless and are the manual escape hatch.

  AUTHENTICATION, and why it fails closed. This endpoint pushes inventory
  figures to external marketplaces. An unauthenticated version would let anyone
  drive the store's push rate — trivially exhausting a marketplace rate limit
  and stalling every subsequent sync. So with no CRON_SECRET set, cron callers
  are rejected outright rather than allowed through "for now".

  Two callers are accepted:
    - Vercel cron, which presents `Authorization: Bearer $CRON_SECRET`
    - a signed-in staff member, for the admin's "Sync now"
  Both are checked; neither is optional.

  Comparison is constant-time with a length check first, because timingSafeEqual
  throws on mismatched lengths — the same shape as the EasyParcel webhook.
*/
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET ?? "";

function isCron(request: Request): boolean {
  if (!CRON_SECRET) return false; // fail closed
  const presented = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${CRON_SECRET}`;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function handle(request: Request) {
  let authorised = isCron(request);

  /*
    Session auth on POST only — a cookie is attached to any cross-site GET a
    hostile page provokes, and this route drains marketplaces. Vercel cron is
    unaffected: it presents CRON_SECRET as a Bearer header.
  */
  if (!authorised && request.method !== "GET") {
    const current = await getCurrentUser();
    authorised = Boolean(current && isStaff(current.role));
  }

  if (!authorised) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  /*
    Opt-in, and only ever from the caller — never inferred from the clock. A
    route that decided "it's 3am, sweep everything" would run the expensive
    lane on whichever invocation happened to land in that hour, including a
    staff member pressing "Sync now".
  */
  const reconcile = new URL(request.url).searchParams.get("reconcile") === "1";

  try {
    const report = await drain({ reconcile });
    return NextResponse.json({ ok: true, reconcile, ...report });
  } catch (err) {
    /*
      A 500 here is correct, unlike the inbound webhook's deliberate 200: the
      caller is our own cron, and a failed drain SHOULD show up as a failed
      invocation rather than a silent success in the dashboard.
    */
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "drain failed" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
