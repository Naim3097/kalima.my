import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/*
  Refreshes the Supabase auth session on every request so Server Components
  never read an expired token, and gates protected routes.

  This is Next 16's `proxy` convention — the former `middleware.ts`, which is
  deprecated. Supabase's docs still show the old name.

  Route protection:
    /admin/*   → staff or admin role, else redirect to /login
    /account/* → any signed-in user, else redirect to /login
  Enforced here (redirects) AND re-checked in the admin layout (defence in
  depth). If Supabase is unconfigured, nothing is gated — matches the
  seed-data demo where /admin is open.
*/
const STAFF_ROLES = new Set(["staff", "admin"]);

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

  // getUser() performs the refresh AND authenticates against the auth server
  // (never trust getSession() in server code — it doesn't verify the JWT).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const needsAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  // /reset-password runs inside the recovery session the callback establishes,
  // so it needs a signed-in user just like /account.
  const needsAuth =
    pathname === "/account" ||
    pathname.startsWith("/account/") ||
    pathname === "/reset-password";

  if (needsAdmin || needsAuth) {
    if (!user) return redirectToLogin(request);

    if (needsAdmin) {
      const role = (user.app_metadata as { role?: string } | null)?.role;
      if (!role || !STAFF_ROLES.has(role)) {
        // Signed in but not staff — send to the storefront, not the login loop.
        return NextResponse.redirect(new URL("/", request.url));
      }
    }
  }

  /*
    Affiliate attribution: ?ref=slug drops a 30-day cookie, read at checkout and
    stamped onto the order. Set last so it survives whichever response object
    the Supabase cookie plumbing above ended up creating.

    Not httpOnly-sensitive — it holds a public referral slug, not a secret — but
    it is httpOnly anyway so page scripts can't rewrite someone else's
    attribution. lax lets it survive the click-through from an external link.
  */
  const ref = request.nextUrl.searchParams.get("ref");
  if (ref && /^[a-z0-9-]{1,64}$/i.test(ref)) {
    response.cookies.set("kalima_ref", ref.toLowerCase(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
  }

  return response;
}

function redirectToLogin(request: NextRequest): NextResponse {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
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
