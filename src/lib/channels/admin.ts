import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { adapterFor, connectBlockedReason } from "./registry";
import { listConnections, type ChannelConnectionView } from "./tokens";
import { CHANNELS, CHANNEL_LABEL, channelDoes, type Channel } from "./types";

/*
  Read models for /admin/sync.

  Everything here runs through the service-role client, like the rest of
  lib/admin.ts, and returns plain shapes — never a database row with token
  columns attached. See the note on listConnections in ./tokens: a Server
  Component serializes whatever it hands a client component into the RSC
  payload, so a token that reaches this layer would reach the browser.
*/

function admin() {
  const client = createAdminClient();
  if (!client) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return client;
}

/** Channels that carry inventory. The Meta family is messaging-only. */
export const STOCK_CHANNELS: Channel[] = CHANNELS.filter((c) => channelDoes(c, "stock_sync"));

export type ChannelCard = ChannelConnectionView & {
  label: string;
  /** Null when the channel can be connected; otherwise why it cannot. */
  blockedReason: string | null;
  configured: boolean;
  mappedListings: number;
};

export async function getChannelCards(): Promise<ChannelCard[]> {
  const [connections, counts] = await Promise.all([
    listConnections(),
    admin().from("channel_listings").select("channel"),
  ]);

  const byChannel = new Map(connections.map((c) => [c.channel, c]));
  const listingCounts = new Map<string, number>();
  for (const row of (counts.data ?? []) as { channel: Channel }[]) {
    listingCounts.set(row.channel, (listingCounts.get(row.channel) ?? 0) + 1);
  }

  return STOCK_CHANNELS.map((channel) => {
    const existing = byChannel.get(channel);
    return {
      channel,
      label: CHANNEL_LABEL[channel],
      shopName: existing?.shopName ?? null,
      externalShopId: existing?.externalShopId ?? null,
      status: existing?.status ?? "disconnected",
      scopes: existing?.scopes ?? null,
      lastSyncAt: existing?.lastSyncAt ?? null,
      lastError: existing?.lastError ?? null,
      connectedAt: existing?.connectedAt ?? null,
      tokenExpiringSoon: existing?.tokenExpiringSoon ?? false,
      blockedReason: connectBlockedReason(channel),
      configured: adapterFor(channel).configured(),
      mappedListings: listingCounts.get(channel) ?? 0,
    };
  });
}

export type ListingCell = {
  listingId: string;
  externalItemId: string;
  externalModelId: string | null;
  safetyBuffer: number;
  syncEnabled: boolean;
  lastPushedQty: number | null;
  lastPushedAt: string | null;
};

export type SyncRow = {
  variantId: string;
  sku: string;
  productName: string;
  colorName: string;
  size: string;
  stockOnHand: number;
  /** Keyed by channel; absent means this variant is not mapped there. */
  listings: Partial<Record<Channel, ListingCell>>;
};

/*
  One row per variant, with its mapping on each stock channel.

  Reads the whole catalog rather than paginating: the mapping screen exists to
  find the variants that are NOT mapped, and hiding them behind a page boundary
  is how they stay unmapped.
*/
export async function getSyncRows(): Promise<SyncRow[]> {
  const [variantsRes, listingsRes] = await Promise.all([
    admin()
      .from("product_variants")
      .select("id, sku, color_name, size, stock_on_hand, products!inner(name)")
      .order("sku"),
    admin()
      .from("channel_listings")
      .select(
        "id, channel, variant_id, external_item_id, external_model_id, safety_buffer, sync_enabled, last_pushed_qty, last_pushed_at",
      ),
  ]);

  if (variantsRes.error) throw new Error(`getSyncRows variants: ${variantsRes.error.message}`);
  if (listingsRes.error) throw new Error(`getSyncRows listings: ${listingsRes.error.message}`);

  const byVariant = new Map<string, Partial<Record<Channel, ListingCell>>>();
  for (const l of (listingsRes.data ?? []) as {
    id: string; channel: Channel; variant_id: string; external_item_id: string;
    external_model_id: string | null; safety_buffer: number; sync_enabled: boolean;
    last_pushed_qty: number | null; last_pushed_at: string | null;
  }[]) {
    const entry = byVariant.get(l.variant_id) ?? {};
    entry[l.channel] = {
      listingId: l.id,
      externalItemId: l.external_item_id,
      externalModelId: l.external_model_id,
      safetyBuffer: l.safety_buffer,
      syncEnabled: l.sync_enabled,
      lastPushedQty: l.last_pushed_qty,
      lastPushedAt: l.last_pushed_at,
    };
    byVariant.set(l.variant_id, entry);
  }

  return ((variantsRes.data ?? []) as unknown as {
    id: string; sku: string; color_name: string; size: string;
    stock_on_hand: number; products: { name: string };
  }[]).map((v) => ({
    variantId: v.id,
    sku: v.sku,
    productName: v.products.name,
    colorName: v.color_name,
    size: v.size,
    stockOnHand: v.stock_on_hand,
    listings: byVariant.get(v.id) ?? {},
  }));
}

export type SyncHealth = {
  queued: number;
  running: number;
  failed: number;
  /** Listings on a stock channel that carry no mapping yet. */
  unmappedVariants: number;
  /** External listings seen in a marketplace order we could not map. */
  unmappedFromOrders: { channel: Channel; externalItemId: string; externalModelId: string | null; seen: number }[];
};

export async function getSyncHealth(): Promise<SyncHealth> {
  const [jobsRes, unmappedRes] = await Promise.all([
    admin().from("channel_sync_jobs").select("status"),
    admin()
      .from("channel_order_items")
      .select("external_item_id, external_model_id, channel_orders!inner(channel)")
      .is("variant_id", null),
  ]);

  const counts = { queued: 0, running: 0, failed: 0 };
  for (const j of (jobsRes.data ?? []) as { status: keyof typeof counts | "done" }[]) {
    if (j.status in counts) counts[j.status as keyof typeof counts] += 1;
  }

  // Group the unmapped lines so the report names each listing once with a count,
  // rather than repeating it per order.
  const grouped = new Map<string, { channel: Channel; externalItemId: string; externalModelId: string | null; seen: number }>();
  for (const row of (unmappedRes.data ?? []) as unknown as {
    external_item_id: string; external_model_id: string | null; channel_orders: { channel: Channel };
  }[]) {
    const channel = row.channel_orders.channel;
    const key = `${channel}|${row.external_item_id}|${row.external_model_id ?? ""}`;
    const existing = grouped.get(key);
    if (existing) existing.seen += 1;
    else grouped.set(key, {
      channel,
      externalItemId: row.external_item_id,
      externalModelId: row.external_model_id,
      seen: 1,
    });
  }

  const rows = await getSyncRows();
  const unmappedVariants = rows.filter((r) =>
    STOCK_CHANNELS.some((c) => !r.listings[c]),
  ).length;

  return {
    ...counts,
    unmappedVariants,
    unmappedFromOrders: [...grouped.values()].sort((a, b) => b.seen - a.seen),
  };
}

export type ActivityEntry = {
  id: string;
  channel: Channel | null;
  level: "info" | "warning" | "error";
  event: string;
  summary: string;
  createdAt: string;
};

export async function getSyncActivity(limit = 40): Promise<ActivityEntry[]> {
  const { data, error } = await admin()
    .from("channel_sync_log")
    .select("id, channel, level, event, summary, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getSyncActivity failed: ${error.message}`);

  return ((data ?? []) as {
    id: string; channel: Channel | null; level: ActivityEntry["level"];
    event: string; summary: string; created_at: string;
  }[]).map((r) => ({
    id: r.id,
    channel: r.channel,
    level: r.level,
    event: r.event,
    summary: r.summary,
    createdAt: r.created_at,
  }));
}

export type ChannelOrderRow = {
  id: string;
  channel: Channel;
  externalOrderId: string;
  status: string | null;
  buyerName: string | null;
  totalSen: number | null;
  orderedAt: string | null;
  lines: number;
};

export async function getChannelOrders(limit = 25): Promise<ChannelOrderRow[]> {
  const { data, error } = await admin()
    .from("channel_orders")
    .select("id, channel, external_order_id, status, buyer_name, total_sen, ordered_at, channel_order_items(id)")
    .order("ordered_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`getChannelOrders failed: ${error.message}`);

  return ((data ?? []) as unknown as {
    id: string; channel: Channel; external_order_id: string; status: string | null;
    buyer_name: string | null; total_sen: number | null; ordered_at: string | null;
    channel_order_items: { id: string }[];
  }[]).map((o) => ({
    id: o.id,
    channel: o.channel,
    externalOrderId: o.external_order_id,
    status: o.status,
    buyerName: o.buyer_name,
    totalSen: o.total_sen,
    orderedAt: o.ordered_at,
    lines: o.channel_order_items?.length ?? 0,
  }));
}
