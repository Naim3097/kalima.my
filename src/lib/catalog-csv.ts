/*
  The catalog CSV contract, shared by the export route and the import action so
  the two can never drift apart. One row per variant; product columns repeat on
  every row belonging to that product.

  Money is in RINGGIT here (what a shop owner types in a spreadsheet) and is
  converted to integer sen at the boundary — sen remains the only representation
  that touches the database.
*/
export const CSV_COLUMNS = [
  "slug",
  "name",
  "description",
  "fabric",
  "category",
  "price_rm",
  // Blank = not on sale. An older file with no such column at all leaves any
  // existing sale untouched — see the importer.
  "sale_price_rm",
  "best_seller",
  "new_arrival",
  "tone",
  "published",
  "sku",
  "color_name",
  "color_hex",
  "size",
  "variant_price_rm",
  "weight_grams",
  "stock",
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];

export const CATEGORIES = ["women", "men", "accessories"] as const;
export type CsvCategory = (typeof CATEGORIES)[number];

/** Spreadsheets render booleans a dozen ways; accept the common ones. */
export function parseBool(value: string, fallback = false): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return fallback;
  return ["true", "yes", "y", "1", "x"].includes(v);
}

/**
 * Ringgit string -> integer sen. Tolerates "RM1,250.00" and blank.
 * Returns null for blank (meaning "inherit"/"unset"), NaN for unparseable.
 */
export function rmToSen(value: string): number | null | typeof NaN {
  const raw = value.replace(/[Rr][Mm]/g, "").replace(/,/g, "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

/** Non-negative whole number, or NaN. Blank -> fallback. */
export function toInt(value: string, fallback: number): number {
  const raw = value.replace(/,/g, "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return NaN;
  return n;
}

export const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** A ready-to-fill template for someone starting from scratch. */
export const CSV_TEMPLATE_ROW = [
  "ruwa-caftan", "Ruwa Caftan", "Premium satin with a lustrous drape.", "Premium satin",
  "women", "250", "", "true", "false", "#7c252b", "true",
  "KLM-RUWA-CAFTAN-BURGUNDY-S/M", "Burgundy", "#7c252b", "S/M", "", "460", "12",
] as const;
