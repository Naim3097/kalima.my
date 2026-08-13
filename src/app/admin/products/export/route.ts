import { NextResponse } from "next/server";
import { toCsv } from "@/lib/csv";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { CSV_COLUMNS } from "@/lib/catalog-csv";

/*
  Catalog export — one row per VARIANT, with the product columns repeated on
  each of its rows. That is the same shape the importer reads, so an export can
  be edited in a spreadsheet and imported straight back.

  Money is written in ringgit (the spreadsheet-friendly unit) and converted
  back to integer sen on import.
*/
export const dynamic = "force-dynamic";

export async function GET() {
  const current = await getCurrentUser();
  if (!current || !isStaff(current.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const db = createAdminClient();
  if (!db) return NextResponse.json({ error: "Admin is not configured" }, { status: 503 });

  const { data, error } = await db
    .from("products")
    .select("slug, name, description, fabric, category, price_sen, sale_price_sen, best_seller, new_arrival, tone, published, product_variants(sku, color_name, color_hex, size, price_sen, weight_grams, stock_on_hand, color_position, position)")
    .order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows: (string | number | boolean | null)[][] = [[...CSV_COLUMNS]];

  for (const p of data ?? []) {
    const variants = [...(p.product_variants ?? [])].sort(
      (a, b) => a.color_position - b.color_position || a.position - b.position,
    );
    // A product with no variants still exports one row so it round-trips.
    const list: (typeof variants[number] | null)[] = variants.length ? variants : [null];

    for (const v of list) {
      rows.push([
        p.slug, p.name, p.description ?? "", p.fabric ?? "", p.category,
        p.price_sen / 100,
        p.sale_price_sen == null ? "" : p.sale_price_sen / 100,
        p.best_seller, p.new_arrival, p.tone, p.published,
        v?.sku ?? "", v?.color_name ?? "", v?.color_hex ?? "", v?.size ?? "",
        v?.price_sen == null ? "" : v.price_sen / 100,
        v?.weight_grams ?? "", v?.stock_on_hand ?? "",
      ]);
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="kalima-catalog-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
