/*
  The vocabulary of the Conversions API, and nothing else.

  DELIBERATELY DEPENDENCY-FREE — no `server-only`, no database client, no Next.
  The browser fires four of these seven events, so the names and the rules for
  normalising a value have to be importable from a Client Component; putting
  them in capi.ts would drag its Supabase client and its credentials into the
  browser bundle. That is a build error rather than a leak, but the split is the
  same one `src/lib/trust-icons.ts` and `src/lib/channels/quantity.ts` already
  made, for the same reason.

  It is also what a browser Pixel would share, if one is ever added: the Pixel
  and the server have to agree on an event_id or Meta counts the same purchase
  twice.
*/

/*
  The seven events Kalima sends, exactly as Meta's Events Manager implementation
  guide for this dataset defines them. Not a judgement about which events are
  worth having — this list came from the shop's marketing partner and the names
  are Meta's own spelling, which is case-sensitive.
*/
export const CAPI_EVENTS = [
  "ViewContent",
  "Search",
  "AddToCart",
  "AddToWishlist",
  "InitiateCheckout",
  "AddPaymentInfo",
  "Purchase",
] as const;

export type CapiEvent = (typeof CAPI_EVENTS)[number];

/*
  What the BROWSER may ask us to send.

  Purchase and AddPaymentInfo are absent on purpose. Both are fired server-side
  from facts the server already holds — a settled payment, an order row — and
  neither can be honestly asserted by a page. Left on this list, a script could
  post conversions into the dataset all day and the shop's reported revenue
  would be whatever the last person to look at the network tab decided.
*/
export const BROWSER_EVENTS: readonly CapiEvent[] = [
  "ViewContent",
  "Search",
  "AddToCart",
  "AddToWishlist",
  "InitiateCheckout",
];

export function isBrowserEvent(name: string): name is CapiEvent {
  return (BROWSER_EVENTS as readonly string[]).includes(name);
}

/*
  Meta deduplicates on (event_id, event_name).

  There is no Pixel today, so nothing is being deduplicated against — this is
  insurance, and it is nearly free. The moment a Pixel appears in the GTM
  container it will report the same purchase the server already reported, and
  without a matching id on both sides Meta counts two. Retrofitting ids after
  that has happened means the overlap is already in the reporting.

  Purchase passes the order reference, so a retried send carries the id of the
  first attempt and cannot be counted twice. Browsing events have no such
  natural key and get a random one.
*/
export function eventIdFor(stable?: string | null): string {
  if (stable) return stable;
  /* Not crypto — this is a correlation id, not a secret, and the module has to
     stay importable in the browser where node:crypto is not. */
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/*
  Meta wants customer information lowercased and trimmed BEFORE it is hashed,
  because it hashes its own copy the same way and compares the digests. A stray
  capital letter does not degrade the match — it destroys it, silently, and the
  only symptom is a match quality score nobody is looking at.
*/
export function normaliseForHash(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

/*
  Dialling codes for the countries Kalima ships to (see src/lib/shipping/countries.ts).

  Needed because Meta wants a phone number with its country code and Malaysians
  do not type one — see normalisePhone.
*/
const DIAL_CODES: Record<string, string> = {
  MY: "60", SG: "65", BN: "673", ID: "62", TH: "66", PH: "63", VN: "84",
  AU: "61", NZ: "64", GB: "44", IE: "353", US: "1", CA: "1", AE: "971",
  SA: "966", QA: "974", KW: "965", BH: "973", OM: "968", JP: "81",
  KR: "82", TW: "886", HK: "852",
};

/*
  Phone: country code first, digits only, no leading '+'.

  THIS IS THE PARAMETER MOST EASILY GOT WRONG WITHOUT ANYTHING SAYING SO.
  Checkout validates Malaysian numbers as /^01\d{8,9}$/ and stores them exactly
  as typed — "012-345 6789". Stripping punctuation gives "0123456789", which is
  a perfectly plausible string and matches nobody at Meta: it has a trunk '0'
  where a country code belongs. The request still succeeds, Events Manager still
  reports `ph` at full coverage, and the only symptom is a match quality score
  that never improves.

  So the destination country converts it: drop the national trunk '0', prefix
  the dialling code. A number that already carries its country code is left
  alone. And when neither is true — an overseas number typed without a code, for
  a country we have no code for — this returns NULL rather than guessing. An
  absent `ph` costs one matching signal; a wrong one costs the same and looks
  like success.

  Deliberately NOT `toE164` from src/lib/channels/meta.ts: that formats WhatsApp
  ids, which already arrive with a country code and want the '+' this must not
  have.
*/
export function normalisePhone(
  value: string | null | undefined,
  country?: string | null,
): string | null {
  if (!value) return null;
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return null;

  const dial = DIAL_CODES[(country ?? "").trim().toUpperCase()];

  if (digits.startsWith("0")) {
    /* National format. Only resolvable with a country to attach. */
    if (!dial) return null;
    return `${dial}${digits.slice(1)}`;
  }

  /* Already international, or a national number that happens not to start with
     a trunk zero. If it starts with the destination's code, take it as it is. */
  if (dial && digits.startsWith(dial)) return digits;
  if (dial) return `${dial}${digits}`;

  /* No country to reason with. Long enough to plausibly carry its own code is
     the best we can do; shorter is a national number we cannot complete. */
  return digits.length >= 10 ? digits : null;
}

/*
  Sen to the major unit Meta reports in. Written here rather than inline so the
  browser and the server cannot round differently — a Purchase of "59" against a
  ViewContent of "59.00" is the same money and two different strings.
*/
export function toMajorUnit(sen: number): number {
  return Math.round(sen) / 100;
}
