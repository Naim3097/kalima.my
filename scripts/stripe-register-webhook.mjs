/*
  Registers the shop's Stripe webhook endpoint and prints its signing secret.

    node --env-file=.env.local scripts/stripe-register-webhook.mjs https://staging.kalima.my

  Needs STRIPE_SECRET_KEY in the environment (test key → test-mode endpoint,
  live key → live endpoint; Stripe keeps the two separate). Prints the whsec_…
  once — Stripe never shows it again — so paste it straight into
  STRIPE_WEBHOOK_SECRET for that environment. Idempotent: an endpoint already
  registered for the same URL is reported rather than duplicated (Stripe would
  otherwise happily create a second one, and two endpoints mean two deliveries
  of every event).
*/
const origin = (process.argv[2] ?? "").replace(/\/+$/, "");
const key = process.env.STRIPE_SECRET_KEY;
if (!origin || !key) {
  console.error("usage: STRIPE_SECRET_KEY=sk_… node scripts/stripe-register-webhook.mjs https://<site>");
  process.exit(1);
}
const url = `${origin}/api/payments/stripe/webhook`;
const EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
];
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" };

const existing = await fetch("https://api.stripe.com/v1/webhook_endpoints?limit=100", { headers }).then((r) => r.json());
const dup = (existing.data ?? []).find((e) => e.url === url);
if (dup) {
  console.log(`Already registered: ${dup.id} → ${url} (${dup.status}); events: ${dup.enabled_events.join(", ")}`);
  console.log("Its secret was shown only at creation. Roll it in the Stripe dashboard if you no longer have it.");
  process.exit(0);
}

const body = new URLSearchParams({ url, description: "Kalima checkout settlement" });
EVENTS.forEach((e, i) => body.append(`enabled_events[${i}]`, e));
const created = await fetch("https://api.stripe.com/v1/webhook_endpoints", { method: "POST", headers, body }).then((r) => r.json());
if (created.error) {
  console.error("Stripe refused:", created.error.message);
  process.exit(1);
}
console.log(`Registered ${created.id} → ${url}`);
console.log(`STRIPE_WEBHOOK_SECRET=${created.secret}`);
console.log(`(${key.startsWith("sk_live_") ? "LIVE" : "test"} mode — set this on the matching Vercel environment)`);
