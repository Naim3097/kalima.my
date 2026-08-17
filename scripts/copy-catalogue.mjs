/*
  Copies catalogue + CMS data from one Supabase project to another.

  Written for seeding the staging project created on 2026-08-17, and kept so
  staging can be refreshed from production whenever it drifts:

    node scripts/copy-catalogue.mjs

  WHY A SCRIPT RATHER THAN A DUMP. `supabase db dump` needs pg_dump and psql,
  neither of which is installed here, and its only filter is an EXCLUDE list —
  the wrong polarity when the thing you must not copy is customers' personal
  data, because a table added later would be copied by default. This uses an
  explicit ALLOWLIST instead: anything not named below is never read.

  WHY plain fetch AND NOT @supabase/supabase-js. Creating a supabase-js client
  also constructs a Realtime client, which needs a native WebSocket and so
  requires Node 22+; this machine runs Node 20 and the script died on import.
  Only PostgREST is needed here, and that is just HTTP — so there is no
  dependency and no Node-version coupling at all.

  WHAT IS DELIBERATELY NOT COPIED, and why it matters:
    orders, order_items, addresses, payments, shipments, profiles,
    conversations, messages, newsletter_subscribers, campaigns,
    campaign_recipients, affiliates, affiliate_*, loyalty_ledger,
    discount_redemptions        -> real names, addresses, phone numbers, emails.
                                   Duplicating them into a second database is a
                                   PDPA exposure /pages/privacy does not cover.
    channel_connections         -> live marketplace ACCESS TOKENS.
    store_settings              -> holds the EasyParcel token; the schema
                                   already inserts its id=1 default row.
    stock_movements,
    admin_audit_log, channel_*  -> operational history that is meaningless
                                   detached from the orders it describes.

  Consequence to know about: product_variants arrives WITH stock_on_hand but
  WITHOUT the stock_movements that explain it, so staging's ledger will not
  reconcile to its stock. That is fine for staging and is not a bug.

  Env (put the staging pair in .env.local while you run this, then remove):
    NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY            <- SOURCE
    STAGING_SUPABASE_URL     / STAGING_SUPABASE_SERVICE_ROLE_KEY    <- TARGET
*/
import { readFileSync } from "node:fs";

/* The production project. Hardcoded as a GUARD, not as configuration: this
   script deletes rows before inserting them, so pointing it at production would
   wipe the live catalogue. It refuses rather than trusting the operator. */
const PRODUCTION_REF = "gylsymfonxyegdlfodvk";

/*
  Insert order. Parents before children, because the target enforces the same
  foreign keys production does. Deletion walks this list backwards.

  `deleteAll` is the PostgREST filter used to clear the table. PostgREST refuses
  an unfiltered DELETE, and collection_products has no `id`, so each table names
  a column it definitely has.
*/
const TABLES = [
  { name: "collections", deleteAll: "id=not.is.null" },
  /* search_vector is GENERATED ALWAYS; sending it back is rejected. */
  { name: "products", deleteAll: "id=not.is.null", drop: ["search_vector"] },
  { name: "product_variants", deleteAll: "id=not.is.null" },
  { name: "product_images", deleteAll: "id=not.is.null" },
  { name: "collection_products", deleteAll: "collection_id=not.is.null" },
  { name: "product_addons", deleteAll: "id=not.is.null" },
  { name: "lookbook_shots", deleteAll: "id=not.is.null" },
  { name: "announcements", deleteAll: "id=not.is.null" },
  { name: "hero_slides", deleteAll: "id=not.is.null" },
  { name: "content_pages", deleteAll: "id=not.is.null" },
  { name: "discount_codes", deleteAll: "id=not.is.null" },
  { name: "loyalty_rules", deleteAll: "id=not.is.null" },
  { name: "membership_tiers", deleteAll: "id=not.is.null" },
  { name: "canned_replies", deleteAll: "id=not.is.null" },
  /*
    THE ONE DELIBERATE EXCEPTION to "no personal data in staging".

    role_grants maps an email to a role, and handle_new_user_role() reads it when
    an auth.users row is inserted — so a grant here is what makes someone an
    admin on staging when they sign up. Without it staging has no way in at all:
    a fresh project has no users, and role authority lives in the JWT rather than
    in a table anyone can edit after the fact.

    Copied rather than hand-typed so staff addresses never pass through a
    transcript, and so staging access stays in step with production on a refresh.
    It carries emails and nothing else — no names, addresses or order history.
  */
  { name: "role_grants", deleteAll: "email=not.is.null" },
];

/* Minimal .env.local reader — this runs outside Next, so process.env is bare.
   Deliberately does not overwrite anything already exported in the shell. */
function loadEnvLocal() {
  let raw = "";
  try {
    raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

loadEnvLocal();

const SOURCE = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
const TARGET = { url: process.env.STAGING_SUPABASE_URL, key: process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY };

const missing = Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: SOURCE.url,
  SUPABASE_SERVICE_ROLE_KEY: SOURCE.key,
  STAGING_SUPABASE_URL: TARGET.url,
  STAGING_SUPABASE_SERVICE_ROLE_KEY: TARGET.key,
})
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (missing.length) {
  console.error(`Missing env: ${missing.join(", ")}`);
  process.exit(1);
}

/* THE GUARD. Never let the destructive half run against production. */
if (TARGET.url.includes(PRODUCTION_REF)) {
  console.error(
    `Refusing to run: the TARGET is production (${PRODUCTION_REF}).\n` +
      `This script deletes before inserting. Point STAGING_SUPABASE_URL at staging.`,
  );
  process.exit(1);
}
if (!SOURCE.url.includes(PRODUCTION_REF)) {
  console.warn(`Note: source is ${SOURCE.url}, not the usual production project.`);
}

const headers = (p, extra = {}) => ({
  apikey: p.key,
  Authorization: `Bearer ${p.key}`,
  "Content-Type": "application/json",
  ...extra,
});

async function rest(p, path, init = {}) {
  const res = await fetch(`${p.url}/rest/v1/${path}`, init);
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${await res.text()}`);
  return res;
}

/* PostgREST caps a response at 1000 rows by default; page so a bigger catalogue
   later does not silently copy only the first page. */
async function readAll(table) {
  const out = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const res = await rest(SOURCE, `${table}?select=*`, {
      headers: headers(SOURCE, { Range: `${from}-${from + size - 1}`, "Range-Unit": "items" }),
    });
    const batch = await res.json();
    out.push(...batch);
    if (batch.length < size) return out;
  }
}

console.log(`source ${SOURCE.url}\ntarget ${TARGET.url}\n`);

/* Clear children before parents, so foreign keys never block the delete. */
for (const { name, deleteAll } of [...TABLES].reverse()) {
  await rest(TARGET, `${name}?${deleteAll}`, {
    method: "DELETE",
    headers: headers(TARGET, { Prefer: "return=minimal" }),
  });
}
console.log("target cleared\n");

let total = 0;
for (const { name, drop } of TABLES) {
  const rows = await readAll(name);
  const clean = drop
    ? rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.includes(k))))
    : rows;

  /* Chunked: one 200-row request beats 200 round trips, and stays well inside
     any request-size limit. */
  for (let i = 0; i < clean.length; i += 200) {
    await rest(TARGET, name, {
      method: "POST",
      headers: headers(TARGET, { Prefer: "return=minimal" }),
      body: JSON.stringify(clean.slice(i, i + 200)),
    });
  }

  total += clean.length;
  console.log(`  ${name.padEnd(22)} ${String(clean.length).padStart(4)} rows`);
}

console.log(`\ncopied ${total} rows across ${TABLES.length} tables`);
