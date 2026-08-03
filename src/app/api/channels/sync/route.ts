import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { drain } from "@/lib/channels/sync";

/*
  Drains the marketplace sync queue. Invoked by Vercel cron every minute, and by
  staff from the admin screen.

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

  if (!authorised) {
    const current = await getCurrentUser();
    authorised = Boolean(current && isStaff(current.role));
  }

  if (!authorised) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  try {
    const report = await drain();
    return NextResponse.json({ ok: true, ...report });
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
