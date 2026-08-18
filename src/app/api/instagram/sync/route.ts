import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { InstagramNotConfigured, syncInstagram } from "@/lib/instagram/sync";

/*
  Refreshes the homepage Instagram strip. Driven daily by
  .github/workflows/instagram-sync.yml, and by staff from the CMS screen.

  WHY NOT A VERCEL CRON. vercel.json already carries two entries and the project
  is on Vercel's Hobby plan, which caps a project at two cron jobs — a third
  fails the BUILD, not just the cron. The marketplace fast lane already solves
  this exact problem from GitHub Actions and documents the trade-off; this
  follows it. If the project moves to Pro, delete the workflow and add
    { "path": "/api/instagram/sync", "schedule": "0 2 * * *" }
  to vercel.json. Nothing in this file changes either way.

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
