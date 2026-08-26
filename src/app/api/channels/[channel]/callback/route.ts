import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { adapterFor, connectBlockedReason } from "@/lib/channels/registry";
import { storeConnection } from "@/lib/channels/tokens";
import { CHANNEL_LABEL, isChannel, stateCookieName } from "@/lib/channels/types";

/*
  OAuth callback for a marketplace or messaging channel.

  Two invariants, both load-bearing and both inherited from the EasyParcel
  callback that documents why:

  1. `state` proves only that this round trip started in THIS browser. It
     carries no identity and is never used to decide whose account is being
     connected.
  2. Identity comes from the Supabase session, re-checked here. Without that,
     anyone could call this endpoint with their own authorisation code and
     attach their marketplace account to Kalima's store — taking over the
     inventory feed and reading customers' conversations.

  The state comparison is constant-time with a length check first, because
  timingSafeEqual throws on mismatched lengths.
*/
export const dynamic = "force-dynamic";

/* Back to the Sync page on the host the request came from — NEXT_PUBLIC_APP_URL
   when set, otherwise the request's own origin, never a hardcoded localhost
   (see the shipping callback for the staging bounce that motivated this). */
function back(request: NextRequest, message: string, ok = false) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost:3000";
  const proto = request.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const url = new URL(
    `/admin/sync?${ok ? "connected" : "error"}=${encodeURIComponent(message)}`,
    process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${host}`,
  );
  return NextResponse.redirect(url);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ channel: string }> },
) {
  // (2) Identity from the session, never from the query string.
  const current = await getCurrentUser();
  if (!current || !isStaff(current.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { channel } = await params;
  if (!isChannel(channel)) {
    return NextResponse.json({ error: "Unknown channel" }, { status: 404 });
  }

  const label = CHANNEL_LABEL[channel];
  const search = request.nextUrl.searchParams;

  /*
    (1) CSRF FIRST, before any config or error branching.

    Authenticity is a property of the request, so it is settled before we act
    on anything the request says. OAuth requires the authorization server to
    echo `state` even on an error response, so a genuine refusal still carries
    it and is reported accurately below.

    Ordering this after the not-configured check — the obvious arrangement —
    would leave this comparison unreachable until an adapter is wired, which
    is weeks away. Security code that cannot be exercised is security code
    nobody knows is broken.
  */
  const state = search.get("state");
  const jar = await cookies();
  const cookieName = stateCookieName(channel);
  const expected = jar.get(cookieName)?.value;
  jar.delete(cookieName);

  const a = Buffer.from(state ?? "");
  const b = Buffer.from(expected ?? "");
  if (!state || !expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return back(request, "That connection attempt could not be verified. Please try again.");
  }

  const denied = search.get("error_description") ?? search.get("error");
  if (denied) return back(request, `${label} refused the connection: ${denied}`);

  const code = search.get("code");
  if (!code) return back(request, `${label} did not return an authorisation code.`);

  const blocked = connectBlockedReason(channel);
  if (blocked) return back(request, blocked);

  try {
    const tokens = await adapterFor(channel).exchangeCode(code);
    await storeConnection(channel, tokens, current.user.id);
  } catch (e) {
    return back(request, e instanceof Error ? e.message : "Could not complete the connection.");
  }
  return back(request, `${label} connected.`, true);
}
