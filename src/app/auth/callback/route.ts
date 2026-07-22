import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/*
  Handles the email-confirmation / OAuth redirect: exchanges the one-time code
  for a session, then sends the user on. Supabase appends ?code=... to the
  emailRedirectTo URL.
*/
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/account";

  if (code) {
    const supabase = await createClient();
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(`${origin}${dest}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=confirm`);
}
