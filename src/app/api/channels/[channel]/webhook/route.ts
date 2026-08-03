import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { adapterFor } from "@/lib/channels/registry";
import { isChannel, channelDoes, type ChannelOrderInput } from "@/lib/channels/types";

/*
  Inbound marketplace order webhooks.

  AUTHENTICATION IS DELEGATED, AND FAILS CLOSED. Unlike EasyParcel — which
  publishes no signing scheme at all, forcing a shared secret — Shopee, TikTok
  and Meta all sign their payloads, and each does it differently. So the check
  belongs in the adapter, and this route only decides what to do with the
  answer. An unwired adapter returns false from verifyWebhook (never true), so
  before any credentials exist this endpoint accepts nothing.

  That ordering matters: this handler runs on the service-role client and
  decrements real inventory. An unauthenticated version would let anyone drain
  the shop's stock to zero by POSTing invented orders.

  THE RAW BODY IS READ FIRST and passed to the verifier untouched. Every
  platform signs the exact bytes it sent; re-serializing parsed JSON changes key
  order and whitespace and invalidates the signature. lib/payments/leanx.ts
  hashes the raw body for the same reason.

  RESPONSE DISCIPLINE. 200 on anything we merely could not process — unknown
  listing, malformed line, storage hiccup — so the platform stops retrying a
  payload that will never succeed. 401 is reserved for a failed signature, which
  a legitimate sender never sees. Failures are logged, not surfaced.
*/
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ channel: string }> },
) {
  const { channel } = await params;
  if (!isChannel(channel) || !channelDoes(channel, "stock_sync")) {
    return NextResponse.json({ error: "Unknown channel" }, { status: 404 });
  }

  // Raw first — see the note above. Never request.json() before verifying.
  const rawBody = await request.text();

  const adapter = adapterFor(channel);
  if (!adapter.verifyWebhook(rawBody, request.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();
  if (!db) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  try {
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ received: true, note: "body was not json" });
    }

    const orders: ChannelOrderInput[] = adapter.parseWebhook(payload);
    // Valid payloads that carry no order — heartbeats, status pings — are
    // normal traffic, not an error.
    if (orders.length === 0) {
      return NextResponse.json({ received: true, orders: 0 });
    }

    const results: { order: string; applied: boolean; reason?: string }[] = [];

    for (const order of orders) {
      const { data, error } = await db.rpc("record_channel_sale", {
        p_channel: channel,
        p_external_order_id: order.externalOrderId,
        p_status: order.status,
        p_buyer_name: order.buyerName,
        p_total_sen: order.totalSen,
        p_ordered_at: order.orderedAt,
        p_items: order.items.map((i) => ({
          external_item_id: i.externalItemId,
          external_model_id: i.externalModelId,
          qty: i.qty,
          unit_price_sen: i.unitPriceSen,
        })),
        p_raw: payload as Record<string, unknown>,
      });

      if (error) {
        // Recorded against the channel so it surfaces in the admin activity
        // log rather than only in a server log nobody reads.
        await db.from("channel_sync_log").insert({
          channel,
          level: "error",
          event: "order_import_failed",
          summary: `Could not import ${channel} order ${order.externalOrderId}: ${error.message}`,
          meta: { external_order_id: order.externalOrderId },
        });
        results.push({ order: order.externalOrderId, applied: false, reason: error.message });
        continue;
      }

      const r = (data ?? {}) as { applied?: boolean; reason?: string };
      results.push({
        order: order.externalOrderId,
        applied: Boolean(r.applied),
        reason: r.reason,
      });
    }

    return NextResponse.json({ received: true, results });
  } catch {
    // Deliberately 200 — see the response-discipline note above.
    return NextResponse.json({ received: true, note: "could not process" });
  }
}
