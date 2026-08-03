import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { adapterFor, connectBlockedReason } from "@/lib/channels/registry";
import { isChannel, stateCookieName } from "@/lib/channels/types";

/*
  Starts the OAuth round trip for a marketplace or messaging channel.

  Staff-only: connecting an account decides whose inventory we move and whose
  customer conversations we read, so an anonymous caller must never be able to
  begin it.

  The `state` value carries NO identity — it only proves the round trip started
  in this browser. This is the property the EasyParcel integration documents as
  load-bearing: an earlier version of that reference encoded the user id in
  `state`, which let an attacker attach their own merchant account to someone
  else's store.
*/
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ channel: string }> },
) {
  const current = await getCurrentUser();
  if (!current || !isStaff(current.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { channel } = await params;
  if (!isChannel(channel)) {
    return NextResponse.json({ error: "Unknown channel" }, { status: 404 });
  }

  // Distinguishes "no credentials" from "adapter not written yet" — see
  // connectBlockedReason. Both are 503; only the message differs, and that
  // message is the difference between a config fix and a development task.
  const blocked = connectBlockedReason(channel);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 503 });

  const state = crypto.randomBytes(24).toString("hex");
  const jar = await cookies();
  jar.set(stateCookieName(channel), state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // ten minutes is plenty for a consent screen
  });

  return NextResponse.redirect(adapterFor(channel).authUrl(state));
}
