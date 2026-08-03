import { NextResponse } from "next/server";
import { toCsv } from "@/lib/csv";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { publishableQty } from "@/lib/channels/quantity";
import { isChannel, channelDoes, type Channel } from "@/lib/channels/types";

/*
  Marketplace stock export.

  THE POINT OF THIS FILE: it works today, with no API access at all. Shopee and
  TikTok app approvals are weeks away, but the client is selling on both right
  now. This produces a bulk-update sheet from the same mapping table and the
  same quantity rule the automated push will use, so the manual workflow and the
  eventual automatic one can never disagree about what a marketplace should be
  told.

  The loop it completes:
    seller centre -> export listings -> import here (maps by SKU)
    here -> export stock -> bulk upload to the seller centre

  Quantities come from publishableQty, so the safety buffer is honoured exactly
  as it will be when the push is automatic.

  ?channel= is required. A single file mixing marketplaces would be useless: the
  external ids only mean anything on the platform that issued them.

  Column names are ours, not a specific seller-centre template — those differ
  per platform and change without notice. The client maps columns on upload,
  which every bulk tool supports, and that is more honest than guessing a
  template we cannot test against.
*/
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const current = await getCurrentUser();
  if (!current || !isStaff(current.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const db = createAdminClient();
  if (!db) return NextResponse.json({ error: "Admin is not configured" }, { status: 503 });

  const channel = new URL(request.url).searchParams.get("channel");
  if (!channel || !isChannel(channel) || !channelDoes(channel, "stock_sync")) {
    return NextResponse.json(
      { error: "A ?channel= that carries stock is required (shopee or tiktok)." },
      { status: 400 },
    );
  }

  const { data, error } = await db
    .from("channel_listings")
    .select(
      "external_item_id, external_model_id, external_sku, safety_buffer, sync_enabled, product_variants!inner(sku, color_name, size, stock_on_hand, products!inner(name))",
    )
    .eq("channel", channel as Channel)
    .order("external_item_id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows: (string | number | boolean | null)[][] = [
    [
      "external_item_id",
      "external_model_id",
      "sku",
      "product",
      "variant",
      "stock_on_hand",
      "safety_buffer",
      "quantity",
      "sync_enabled",
    ],
  ];

  for (const l of (data ?? []) as unknown as {
    external_item_id: string;
    external_model_id: string | null;
    external_sku: string | null;
    safety_buffer: number;
    sync_enabled: boolean;
    product_variants: {
      sku: string; color_name: string; size: string; stock_on_hand: number;
      products: { name: string };
    };
  }[]) {
    const v = l.product_variants;
    rows.push([
      l.external_item_id,
      l.external_model_id ?? "",
      v.sku,
      v.products.name,
      `${v.color_name} / ${v.size}`,
      v.stock_on_hand,
      l.safety_buffer,
      // The same rule the automated push uses — see the note above.
      publishableQty(v.stock_on_hand, l.safety_buffer),
      l.sync_enabled,
    ]);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="kalima-${channel}-stock-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
