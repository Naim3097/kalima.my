import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { connectWithCode, easyparcelConfigured } from "@/lib/shipping/config";

/*
  EasyParcel OAuth callback.

  Two invariants, both load-bearing (see EASYPARCEL_INTEGRATION.md §5.2):

  1. `state` proves only that this round trip started in THIS browser. It
     carries no identity and is never used to decide whose account is being
     connected.
  2. Identity comes from the Supabase session, re-checked here. Without that,
     anyone could call this endpoint with their own auth code and attach their
     EasyParcel merchant account to Kalima's store — silently receiving every
     shipment along with customers' names, phones and addresses.
*/
export const dynamic = "force-dynamic";

/*
  Sends staff back to the Shipping page on whatever host they arrived from.

  NEXT_PUBLIC_APP_URL wins when set; otherwise the request's own host. The
  old fallback was localhost:3000 unconditionally, and a staging deploy
  without the variable completed the OAuth exchange perfectly — tokens saved —
  then bounced the browser to a localhost that refused to connect, which reads
  as "the connection failed" when it had not.
*/
function back(request: NextRequest, message: string, ok = false) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost:3000";
  const proto = request.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const url = new URL(
    `/admin/shipping?${ok ? "connected" : "error"}=${encodeURIComponent(message)}`,
    process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${host}`,
  );
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  // (2) Identity from the session, never from the query string.
  const current = await getCurrentUser();
  if (!current || !isStaff(current.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  if (!easyparcelConfigured()) return back(request, "EasyParcel credentials are not configured.");

  const params = request.nextUrl.searchParams;
  const denied = params.get("error");
  if (denied) return back(request, `EasyParcel refused the connection: ${denied}`);

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return back(request, "EasyParcel did not return an authorisation code.");

  // (1) CSRF: the state must match the cookie this browser was issued.
  const jar = await cookies();
  const expected = jar.get("ep_oauth_state")?.value;
  jar.delete("ep_oauth_state");

  const a = Buffer.from(state);
  const b = Buffer.from(expected ?? "");
  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return back(request, "That connection attempt could not be verified. Please try again.");
  }

  try {
    await connectWithCode(code);
  } catch (e) {
    return back(request, e instanceof Error ? e.message : "Could not complete the connection.");
  }
  return back(request, "EasyParcel connected.", true);
}
