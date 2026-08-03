import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/*
  Email-link confirmation via token_hash, NOT the PKCE code exchange.

  WHY THIS EXISTS. /auth/callback uses exchangeCodeForSession, which requires a
  `code_verifier` cookie written on the origin where the request STARTED. That
  ties the whole flow to one browser on one origin — so:

    request the reset on a laptop, open the email on a phone  -> fails
    request on localhost, land on the deployed domain         -> fails
    request in Chrome, open the link in Safari's mail preview -> fails

  For a password reset that is not an edge case, it is the normal case: most
  people read email on their phone. verifyOtp carries the proof in the link
  itself, so there is nothing to correlate against a cookie and it works from
  any device.

  PKCE remains right for OAuth sign-in, where the round trip genuinely does
  start and end in one browser. /auth/callback keeps serving that.

  The token is single-use and expires; Supabase enforces both.
*/
export const dynamic = "force-dynamic";

/* Only the email link types we actually issue. Anything else is refused rather
   than passed through to Supabase — an open type parameter would let a crafted
   link drive a flow we never intended. */
const ALLOWED: readonly EmailOtpType[] = ["recovery", "signup", "email_change", "invite"] as const;

function isAllowed(value: string | null): value is EmailOtpType {
  return Boolean(value && (ALLOWED as readonly string[]).includes(value));
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = searchParams.get("next");

  // Open-redirect guard: only same-site absolute paths.
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/account";

  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}`);

  if (!tokenHash) return fail("link_incomplete");
  if (!isAllowed(type)) return fail("link_unsupported");

  const supabase = await createClient();
  if (!supabase) return fail("auth_unconfigured");

  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    /*
      Distinguish the two failures a user can act on. Previously every path
      produced the same "invalid or expired", which told someone debugging
      nothing at all — including me, for an hour.
    */
    const message = error.message.toLowerCase();
    return fail(
      message.includes("expired") ? "link_expired"
      : message.includes("already") || message.includes("used") ? "link_used"
      : "link_invalid",
    );
  }

  return NextResponse.redirect(`${origin}${dest}`);
}
