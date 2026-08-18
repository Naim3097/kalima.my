import { NextResponse } from "next/server";

/*
  Maintenance mode for the live storefront.

  Driven by MAINTENANCE_MODE, set per Vercel environment. Set it on Production
  only and staging is untouched — that is the whole point of the switch: one
  domain closed to the public, the other open for building.

  Deliberately NOT a host check. Preview deployments and vercel.app URLs would
  each need their own rule, and every new domain would silently default to
  "open". An environment variable defaults to closed-nowhere and is turned on
  exactly where it is meant to apply.
*/
export function maintenanceEnabled(): boolean {
  return process.env.MAINTENANCE_MODE === "on";
}

/*
  Paths that stay reachable while the shop is closed.

  Webhooks are here because a maintenance window does not pause the outside
  world. LeanX has already taken a customer's money by the time it calls us; if
  that call 503s through its whole retry schedule, the order is paid and we
  never know. Same for EasyParcel tracking and the marketplace channels.

  The rest are the doors staff use to get in. /admin keeps its own role gate in
  proxy.ts, so listing it here opens nothing — it just means a signed-out
  staff member gets the login page instead of the closed sign.

  /pages/privacy is the odd one out: it is a public page, not a door or a
  webhook. Meta refuses to take the WhatsApp app out of Development mode
  without a Privacy Policy URL it can fetch, and it re-checks that URL later —
  a 503 reads as invalid and would take the messaging channel down with it.
  Opening it costs nothing, because a privacy notice is a legal statement about
  a closed shop rather than a way into one, and PDPA 2010 s.7 requires it to be
  available to anyone whose data we already hold regardless of whether we are
  currently selling. Note this is the exact path, not the /pages/ prefix: the
  rest of the content pages stay closed.
*/
const OPEN_DURING_MAINTENANCE = [
  /*
    The whole payments prefix, not one route. This listed the LeanX callback
    only, on the reasoning that a gateway has already taken the customer's money
    by the time it calls us — which is just as true of Atome, whose callback
    lives at /api/payments/atome/webhook and was being 503'd. A closed shop must
    still settle a payment it has already accepted.
  */
  "/api/payments",
  "/api/shipping/webhook",
  "/api/shipping/callback",
  "/api/shipping/connect",
  "/api/channels",
  "/login",
  "/auth",
  "/reset-password",
  "/admin",
  "/pages/privacy",
];

export function isOpenDuringMaintenance(pathname: string): boolean {
  return OPEN_DURING_MAINTENANCE.some(
    (base) => pathname === base || pathname.startsWith(`${base}/`),
  );
}

/*
  503, not 200.

  A maintenance page served as 200 tells Google the closed sign IS the page,
  and kalima.my's rankings go with it. 503 + Retry-After says "temporarily
  unavailable, come back" — crawlers hold the existing index entry instead of
  replacing it. no-store keeps Vercel's CDN from pinning this response and
  still serving it after the switch is turned off.
*/
export function maintenanceResponse(): NextResponse {
  return new NextResponse(MAINTENANCE_PAGE, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "retry-after": "3600",
      "cache-control": "no-store, must-revalidate",
    },
  });
}

/*
  Self-contained: inline styles, system fonts, no images. It is returned from
  the proxy, so it never reaches the Next asset pipeline — anything it linked
  to would have to be reachable during maintenance too, which is exactly the
  loop a closed site should not have.
*/
const MAINTENANCE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kalima — We'll be back shortly</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    background: #f7f3ec;
    color: #383c61;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: 30rem; text-align: center; }
  .wordmark {
    font-family: ui-serif, Georgia, "Times New Roman", serif;
    font-size: clamp(1.5rem, 5vw, 2rem);
    font-weight: 400;
    letter-spacing: 0.3em;
    margin: 0 0 2.5rem;
    text-indent: 0.3em;
  }
  .rule { width: 3rem; height: 1px; background: #e3d7c6; margin: 0 auto 2.5rem; border: 0; }
  h1 {
    font-family: ui-serif, Georgia, "Times New Roman", serif;
    font-size: clamp(1.75rem, 6vw, 2.5rem);
    font-weight: 400;
    line-height: 1.25;
    margin: 0 0 1.25rem;
  }
  p { margin: 0; font-size: 1rem; line-height: 1.7; color: #686c8f; }
  .note { margin-top: 2.5rem; font-size: 0.8125rem; letter-spacing: 0.08em; text-transform: uppercase; color: #9b9cb0; }
</style>
</head>
<body>
<main>
  <p class="wordmark">KALIMA</p>
  <hr class="rule">
  <h1>We&rsquo;ll be back shortly</h1>
  <p>Our boutique is closed for a short while as we make some improvements. Thank you for your patience &mdash; do come back soon.</p>
  <!-- Add a contact line here (WhatsApp / email) so customers with an order in
       flight have somewhere to go while the shop is closed. -->
  <p class="note">Kalima &middot; Malaysia</p>
</main>
</body>
</html>`;
