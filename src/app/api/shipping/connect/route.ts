import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { authUrl, easyparcelConfigured } from "@/lib/shipping/config";

/*
  Starts the EasyParcel OAuth round trip.

  Staff-only: connecting an account decides which merchant wallet pays for every
  future shipment, so an anonymous caller must never be able to begin it.

  The `state` value carries NO identity — it only proves the round trip started
  in this browser. The reference integration records that an earlier version
  encoded the user id in `state`, which let an attacker attach their own
  EasyParcel account to someone else's store and receive their shipments.
*/
export const dynamic = "force-dynamic";

export async function GET() {
  const current = await getCurrentUser();
  if (!current || !isStaff(current.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  if (!easyparcelConfigured()) {
    return NextResponse.json(
      { error: "EASYPARCEL_CLIENT_ID / _CLIENT_SECRET / _REDIRECT_URI are not set." },
      { status: 503 },
    );
  }

  const state = crypto.randomBytes(24).toString("hex");
  const jar = await cookies();
  jar.set("ep_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // ten minutes is plenty for a consent screen
  });

  return NextResponse.redirect(authUrl(state));
}
