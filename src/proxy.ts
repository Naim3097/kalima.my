import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/*
  Refreshes the Supabase auth session on every request so Server Components
  never read an expired token. No-ops until Supabase env vars are set.

  This is Next 16's `proxy` convention — the former `middleware.ts`, which is
  deprecated. Supabase's docs still show the old name.

  Route protection (admin/affiliate roles) is added in Phase 2 with auth —
  today /admin is an unguarded demo, as it is on the current build.
*/
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Touching getUser() is what performs the refresh — do not remove.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
      Everything except static assets and image files — those never carry a
      session and would only add latency.
    */
    "/((?!_next/static|_next/image|favicon.ico|brand/|products/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif)$).*)",
  ],
};
