import "server-only";

import { cookies, headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { buildEvent, capiConfigured, postEvent, type CapiIdentity } from "@/lib/meta/capi";
import { isBrowserEvent, toMajorUnit, type CapiEvent } from "@/lib/meta/events";

/*
  The four events that genuinely begin in the browser, plus InitiateCheckout.

  Unlike Purchase and AddPaymentInfo, these run inside the SHOPPER'S OWN
  request — so here, and only here, reading cookies() and headers() is the
  correct thing to do rather than the trap it is in src/lib/meta/orders.ts.

  NOT WRITE-AHEAD. A ViewContent is worth close to nothing on its own: the
  shopper is on the page, more will follow, and the funnel is read in aggregate.
  Two extra database writes per product view to guarantee delivery of one of
  them would be a poor trade. Only money earns that; see dead-letter.ts.
*/

/*
  The site's origin, with any trailing slash removed.

  NOT COSMETIC. These values are typed into a dashboard by a person, and
  "https://www.kalima.my/" is at least as natural to write as the bare origin.
  Left alone it composes "https://www.kalima.my//products/serra-scallop", and
  Meta answers a double slash by discarding the path — every event then reports
  the homepage, which silently breaks URL-based custom audiences ("people who
  viewed a product page") while the events themselves still say Processed.
  Found exactly that way, in Test Events, after everything else looked right.
*/
const BASE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://www.kalima.my"
).replace(/\/+$/, "");

/* Bounds on what a caller may claim. Generous for a person, tedious for a
   script — the same posture as MAX_CART_LINES in the checkout. */
const MAX_LINES = 20;
const MAX_QTY = 20;
const MAX_SEARCH_LENGTH = 200;

export type TrackedItem = { slug: string; qty?: number };

export type TrackInput = {
  event: string;
  items?: TrackedItem[];
  searchString?: string;
  /** Path only. The origin is ours to supply — see sourceUrlFrom. */
  path?: string;
};

/*
  The event's URL, built from a path the caller supplied.

  ONLY THE PATH IS TAKEN. Accepting a full URL would let anyone write another
  site's address into the shop's event stream, which is both a reporting lie and
  a way to make Meta's domain checks fail. Anything that is not a plain
  same-site path falls back to the homepage.
*/
function sourceUrlFrom(path: string | undefined): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return BASE_URL;
  return `${BASE_URL}${path}`;
}

/*
  Prices come from the CATALOGUE, never from the request.

  commerce.ts opens with "never trust amounts from the browser", and an
  analytics endpoint is not an exception to that — it is one of the easier ways
  to abuse one. A caller who could name the value could report a five-figure
  ViewContent and steer the shop's own optimisation with it. So the browser
  sends a slug and we look up what the piece actually costs.

  Unpublished and unknown slugs simply do not come back, which also stops the
  endpoint being used to probe for hidden products.
*/
async function priceBySlug(slugs: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  if (!slugs.length) return prices;

  const client = createAdminClient();
  if (!client) return prices;

  const { data } = await client
    .from("products")
    .select("slug, price_sen, sale_price_sen")
    .in("slug", slugs)
    .eq("published", true);

  for (const row of data ?? []) {
    /* Sale price when there is one — that is what a shopper would pay, and
       reporting the struck-through price would overstate every event. */
    prices.set(row.slug as string, (row.sale_price_sen as number | null) ?? (row.price_sen as number));
  }
  return prices;
}

/*
  Who the shopper is, as far as this request knows.

  A signed-in member contributes a hashed email, phone and name. A guest
  contributes only the cookies and the connection — which is precisely why the
  proxy mints _fbp at all, since without it a signed-out browser would carry no
  matching key whatsoever.
*/
async function identityFromRequest(): Promise<CapiIdentity> {
  const [jar, h] = await Promise.all([cookies(), headers()]);

  const identity: CapiIdentity = {
    fbp: jar.get("_fbp")?.value ?? null,
    fbc: jar.get("_fbc")?.value ?? null,
    ip: h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  };

  try {
    const current = await getCurrentUser();
    if (current) {
      identity.email = current.user.email ?? null;
      identity.phone = current.profile?.phone ?? null;
      identity.externalId = current.user.id;

      const name = (current.profile?.full_name ?? "").trim();
      const space = name.indexOf(" ");
      identity.firstName = space === -1 ? name || null : name.slice(0, space);
      identity.lastName = space === -1 ? null : name.slice(space + 1);
      /* The profile carries no address, so ct/st/zp are absent for browsing
         events — they arrive with the order. Absent beats empty. */
    }
  } catch {
    /* A signed-out shopper is the common case, not a failure. */
  }

  return identity;
}

/*
  Sends one browsing event. Returns quietly whatever happens.

  The caller is a page render or a click handler; there is nothing useful it
  could do with a failure and nothing the shopper should ever see.
*/
export async function trackBrowserEvent(input: TrackInput): Promise<void> {
  if (!capiConfigured()) return;
  /* The allowlist is the load-bearing check: Purchase and AddPaymentInfo are
     not on it, so no request from a browser can ever claim a sale. */
  if (!isBrowserEvent(input.event)) return;

  try {
    const event = input.event as CapiEvent;

    const items = (input.items ?? []).slice(0, MAX_LINES).filter((i) => i?.slug);
    const prices = await priceBySlug(items.map((i) => i.slug));

    const contents = items
      .filter((i) => prices.has(i.slug))
      .map((i) => ({
        id: i.slug,
        quantity: Math.min(Math.max(Math.floor(i.qty ?? 1), 1), MAX_QTY),
        item_price: toMajorUnit(prices.get(i.slug)!),
      }));

    const custom: Record<string, unknown> = {};

    if (contents.length) {
      custom.content_type = "product";
      custom.content_ids = contents.map((c) => c.id);
      custom.contents = contents;
      custom.num_items = contents.reduce((n, c) => n + c.quantity, 0);
      custom.currency = "MYR";
      custom.value = contents.reduce((sum, c) => sum + c.item_price * c.quantity, 0);
    }

    if (event === "Search") {
      const term = (input.searchString ?? "").trim().slice(0, MAX_SEARCH_LENGTH);
      if (!term) return; // an empty search is not an event
      custom.search_string = term;
    }

    await postEvent(
      buildEvent({
        event,
        sourceUrl: sourceUrlFrom(input.path),
        identity: await identityFromRequest(),
        custom,
      }),
    );
  } catch (e) {
    console.error(`[capi] ${input.event} failed:`, e instanceof Error ? e.message : e);
  }
}
