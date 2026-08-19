import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  isOpenDuringMaintenance,
  maintenanceEnabled,
  maintenanceResponse,
} from "@/lib/maintenance";

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

  Also the maintenance gate (see src/lib/maintenance.ts). It lives here rather
  than in a layout because it has to cover route handlers and redirects too —
  a layout only wraps pages, so /api would stay wide open behind a closed sign.
*/
const STAFF_ROLES = new Set(["staff", "admin"]);

/*
  Every response leaves through here, so the indexing policy is applied in one
  place instead of at each `return` — a branch added later cannot forget it.
*/
export async function proxy(request: NextRequest) {
  return applyIndexingPolicy(await route(request));
}

/*
  Keep staging and preview deployments out of search results.

  staging.kalima.my serves the same catalogue as the real shop. Indexed, it
  competes with kalima.my for its own product pages and leaves a public copy of
  work in progress in Google's cache.

  X-Robots-Tag rather than a robots.txt Disallow, which would be the wrong
  tool and actively counterproductive: Disallow stops crawlers fetching the
  page, so they never see a noindex, and Google will still list a URL it has
  been forbidden to read if anything links to it. The header has to be served
  ON a crawlable response to work.

  Keyed on VERCEL_ENV — "production" only on the live deployment, "preview" for
  branch and preview URLs, unset locally. So production is untouched and
  everything else is excluded by default, including preview URLs nobody
  remembered to think about.
*/
function applyIndexingPolicy(response: NextResponse): NextResponse {
  if (process.env.VERCEL_ENV !== "production") {
    response.headers.set("x-robots-tag", "noindex, nofollow");
  }
  return response;
}

async function route(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  // Resolved once: whether the shop is closed, and whether this particular
  // path is one of the few that stays reachable regardless.
  const closed = maintenanceEnabled() && !isOpenDuringMaintenance(pathname);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Without Supabase there is no way to tell staff from the public, so a
    // closed shop stays closed for everyone rather than falling open.
    return closed ? maintenanceResponse() : NextResponse.next();
  }

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

  const role = (user?.app_metadata as { role?: string } | null)?.role;
  const isStaff = !!role && STAFF_ROLES.has(role);

  /*
    Maintenance gate. Staff walk straight through — signing in IS the bypass,
    so there is no secret URL or shared password to leak, and access revokes
    itself the moment a role is removed.
  */
  if (closed && !isStaff) return maintenanceResponse();

  const needsAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  // /reset-password runs inside the recovery session the callback establishes,
  // so it needs a signed-in user just like /account.
  const needsAuth =
    pathname === "/account" ||
    pathname.startsWith("/account/") ||
    // The affiliate portal shows earnings, so it is never public.
    pathname === "/affiliate" ||
    pathname.startsWith("/affiliate/") ||
    pathname === "/reset-password";

  if (needsAdmin || needsAuth) {
    if (!user) return redirectToLogin(request);

    // Signed in but not staff — send to the storefront, not the login loop.
    if (needsAdmin && !isStaff) {
      return NextResponse.redirect(new URL("/", request.url));
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

  attachMetaCookies(request, response);

  return response;
}

/*
  Mints the two cookies Meta's Conversions API matches a shopper on.

  NORMALLY THE PIXEL DOES THIS, AND THERE IS NO PIXEL. Kalima reports to Meta
  entirely server-side, so nothing in the browser sets `_fbp` or reads `fbclid`.
  Without these two values a server event can only be matched on hashed email
  and phone — which means a signed-out browser is unmatchable, and a click
  straight from an ad cannot be attributed to that ad at all. Meta's own spec
  allows the server to set them, and this is that.

  NOT httpOnly, unlike kalima_ref above. The Pixel reads `_fbp` with JavaScript;
  if one is ever added to the GTM container and finds the cookie unreadable, it
  will mint a second, different `_fbp`, and the browser and the server will
  report the same person as two.

  The formats are Meta's and are not ours to prettify: `fb.1.<ms>.<random>` for
  _fbp, `fb.1.<ms>.<fbclid>` for _fbc, where 1 is the subdomain index for a
  cookie set at the registrable domain. 90 days each, which is what the Pixel
  uses; a longer window would claim attribution Meta will not honour.
*/
function attachMetaCookies(request: NextRequest, response: NextResponse): void {
  const NINETY_DAYS = 60 * 60 * 24 * 90;
  const options = {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: NINETY_DAYS,
  };

  if (!request.cookies.get("_fbp")) {
    const random = Math.floor(Math.random() * 10_000_000_000);
    response.cookies.set("_fbp", `fb.1.${Date.now()}.${random}`, options);
  }

  /*
    Refreshed on every arrival that carries one, not just the first. A shopper
    who clicks a second ad should be attributed to the second ad, and Meta's
    guidance is that the most recent click wins.
  */
  const fbclid = request.nextUrl.searchParams.get("fbclid");
  if (fbclid && /^[\w.-]{1,255}$/.test(fbclid)) {
    response.cookies.set("_fbc", `fb.1.${Date.now()}.${fbclid}`, options);
  }
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

      NOTE: the exclusion is by file EXTENSION, not by the `products/`
      directory. `/public/products/*.jpg` is still skipped (it ends in .jpg),
      but the product PAGE route `/products/[slug]` is not — a bare `products/`
      here silently excluded the pages too, so the auth session refresh AND the
      maintenance gate never ran on them, leaving the shop half-open while
      "closed". `brand/` stays because there is no /brand page route to collide
      with.
    */
    "/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif)$).*)",
  ],
};
