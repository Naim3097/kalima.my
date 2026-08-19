import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { InstagramNotConfigured, syncInstagram } from "@/lib/instagram/sync";

/*
  Refreshes the homepage Instagram strip.

  NOTHING SCHEDULES THIS ANY MORE. It ran daily from
  .github/workflows/instagram-sync.yml, deleted on 2026-08-19 along with the
  marketplace one: the account's Actions billing is locked, so every run failed
  in seconds and mailed a failure notice, and a workflow that cannot run and
  only generates alarm is worse than none.

  The only caller left is staff pressing "Refresh from Instagram" on the CMS
  screen. Until someone does, the homepage strip stays empty — it shows real
  posts or nothing, having lost its curated fallback deliberately, so an
  unsynced feed is a missing section rather than a quiet lie.

  To bring the schedule back, either clear the Actions billing and restore that
  file from git history, or drive it from a Vercel cron. Vercel's Hobby plan
  caps a project at two and vercel.json already carries two — a third fails the
  BUILD, not just the cron — so on Hobby that means riding on an existing entry,
  the way the EasyParcel connection check rides on /api/orders/expire. On Pro it
  is simply a third entry for this path. Nothing in this file changes either
  way.

  AUTHENTICATION, and why it fails closed. This endpoint spends Meta API quota
  and writes to Storage. Left open, anyone could drive both. So with no
  CRON_SECRET set, cron callers are rejected outright rather than allowed
  through "for now" — the same standard as the marketplace sync.

  Two callers are accepted:
    - the scheduler, presenting `Authorization: Bearer $CRON_SECRET`
    - a signed-in staff member, for the CMS "Refresh from Instagram"

  Comparison is constant-time with a length check first, because timingSafeEqual
  throws on mismatched lengths.
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

  /* Session auth on POST only — a cookie rides along with any cross-site GET a
     hostile page provokes. The scheduler is unaffected: it sends a Bearer. */
  if (!authorised && request.method !== "GET") {
    const current = await getCurrentUser();
    authorised = Boolean(current && isStaff(current.role));
  }

  if (!authorised) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  try {
    const summary = await syncInstagram();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    /*
      Unconfigured is not a failure — it is a shop that has not connected
      Instagram yet, and the storefront falls back to the curated Lookbook. A
      500 there would turn a nightly no-op into a nightly alarm.
    */
    if (err instanceof InstagramNotConfigured) {
      return NextResponse.json({ ok: true, skipped: "instagram-not-configured" });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Instagram sync failed" },
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
