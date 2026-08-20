/*
  Where Kalima will take an order to.

  A CURATED LIST, not every country on earth. Two reasons. EasyParcel only
  serves some destinations from Malaysia, and a country nobody can be quoted for
  is a dead end a shopper reaches only after typing a full address. And a short
  list is a decision the shop has made, rather than 200 rows nobody reviewed.

  Adding one is a line here. Nothing else knows the list: rates come from
  EasyParcel for whatever country is sent, so an addition needs no other change
  — and if EasyParcel does not serve it, the checkout says so and offers
  WhatsApp rather than quoting a number nobody stands behind.

  Malaysia is first and is the default; it is the only one priced by zone rather
  than by live rate.
*/
/* `dial` is the international dialling prefix, no plus. EasyParcel wants the
   dialling country and the subscriber number in separate fields at booking,
   and a number typed as +60… has to have that prefix removed before it is
   sent as the subscriber part. */
export type Country = { code: string; name: string; dial: string };

export const COUNTRIES: Country[] = [
  { code: "MY", name: "Malaysia", dial: "60" },
  { code: "SG", name: "Singapore", dial: "65" },
  { code: "BN", name: "Brunei", dial: "673" },
  { code: "ID", name: "Indonesia", dial: "62" },
  { code: "TH", name: "Thailand", dial: "66" },
  { code: "PH", name: "Philippines", dial: "63" },
  { code: "VN", name: "Vietnam", dial: "84" },
  { code: "AU", name: "Australia", dial: "61" },
  { code: "NZ", name: "New Zealand", dial: "64" },
  { code: "GB", name: "United Kingdom", dial: "44" },
  { code: "IE", name: "Ireland", dial: "353" },
  { code: "US", name: "United States", dial: "1" },
  { code: "CA", name: "Canada", dial: "1" },
  { code: "AE", name: "United Arab Emirates", dial: "971" },
  { code: "SA", name: "Saudi Arabia", dial: "966" },
  { code: "QA", name: "Qatar", dial: "974" },
  { code: "KW", name: "Kuwait", dial: "965" },
  { code: "BH", name: "Bahrain", dial: "973" },
  { code: "OM", name: "Oman", dial: "968" },
  { code: "JP", name: "Japan", dial: "81" },
  { code: "KR", name: "South Korea", dial: "82" },
  { code: "TW", name: "Taiwan", dial: "886" },
  { code: "HK", name: "Hong Kong", dial: "852" },
];

export const DEFAULT_COUNTRY = "MY";

export const isKnownCountry = (code: string): boolean =>
  COUNTRIES.some((c) => c.code === code.toUpperCase());

/** The dialling prefix for a country, or null when we do not ship there. */
export const dialCodeFor = (code: string): string | null =>
  COUNTRIES.find((c) => c.code === code.toUpperCase())?.dial ?? null;

export const countryName = (code: string): string =>
  COUNTRIES.find((c) => c.code === code.toUpperCase())?.name ?? code.toUpperCase();

/*
  Parcel size by weight.

  EasyParcel prices international shipments on VOLUMETRIC weight as much as
  actual weight, and the client used to send a hardcoded 10×10×10 cube — which
  is not what a folded caftan in a mailer looks like, in either direction.

  Tiers rather than per-product dimensions: everything Kalima sells is folded
  apparel in a poly mailer, so weight predicts size well, and three fields on
  every product would be accuracy this catalogue does not need. The plan calls
  for these to become editable in Admin › Shipping; they are constants until
  that screen exists, which is a smaller lie than the cube was.
*/
export type ParcelSize = { width: number; height: number; length: number };

const PARCEL_TIERS: { upToGrams: number; size: ParcelSize }[] = [
  { upToGrams: 500, size: { width: 25, height: 5, length: 20 } },
  { upToGrams: 1500, size: { width: 35, height: 10, length: 25 } },
  { upToGrams: 3000, size: { width: 40, height: 20, length: 30 } },
];

const LARGEST: ParcelSize = { width: 45, height: 30, length: 35 };

export function parcelSizeFor(weightGrams: number): ParcelSize {
  return PARCEL_TIERS.find((t) => weightGrams <= t.upToGrams)?.size ?? LARGEST;
}
