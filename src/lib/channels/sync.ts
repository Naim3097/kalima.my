import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { publishableQty } from "./quantity";
import { adapterFor } from "./registry";
import { getConnection } from "./tokens";
import { CHANNELS, CHANNEL_LABEL, channelDoes, type Channel } from "./types";

/*
  The stock-sync worker.

  Claiming, backoff and the job queue live in Postgres (claim_sync_jobs /
  release_sync_job) because two cron runs can overlap and only the database can
  settle that race. This module is the loop around them.
*/

function admin() {
  const client = createAdminClient();
  if (!client) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set — sync requires it.");
  return client;
}

/* The quantity rule lives in its own dependency-free module so it is directly
   testable — see ./quantity. Re-exported here because this is where callers
   look for it. */
export { publishableQty } from "./quantity";

export type ClaimedJob = {
  job_id: string;
  channel: Channel;
  kind: "push_stock" | "pull_orders" | "reconcile";
  attempts: number;
  listing_id: string | null;
  external_item_id: string | null;
  external_model_id: string | null;
  variant_id: string | null;
  sku: string | null;
  stock_on_hand: number | null;
  safety_buffer: number | null;
};

export type DrainReport = {
  readyChannels: Channel[];
  skippedChannels: { channel: Channel; reason: string }[];
  claimed: number;
  /* Broken out by kind: one number cannot say whether a run that "did 3 things"
     pushed stock or merely polled, and those fail for different reasons. */
  pushed: number;
  polled: number;
  reconciled: number;
  failed: number;
};

/*
  Channels the worker can actually act on right now: the adapter is wired AND a
  merchant account is connected.

  Jobs for anything else are deliberately not claimed at all (claim_sync_jobs
  takes this list), so they wait as 'queued' instead of burning their retry
  budget against a channel nobody has connected yet. Connecting Shopee next
  month should find pending work, not a pile of dead jobs.
*/
export async function readyChannels(): Promise<{
  ready: Channel[];
  skipped: { channel: Channel; reason: string }[];
}> {
  const ready: Channel[] = [];
  const skipped: { channel: Channel; reason: string }[] = [];

  for (const channel of CHANNELS) {
    if (!channelDoes(channel, "stock_sync")) continue;

    if (!adapterFor(channel).configured()) {
      skipped.push({ channel, reason: "adapter not configured" });
      continue;
    }
    const connection = await getConnection(channel);
    if (!connection || connection.status !== "connected") {
      skipped.push({ channel, reason: "no connected merchant account" });
      continue;
    }
    ready.push(channel);
  }

  return { ready, skipped };
}

async function log(entry: {
  channel: Channel | null;
  level: "info" | "warning" | "error";
  event: string;
  summary: string;
  variantId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await admin().from("channel_sync_log").insert({
      channel: entry.channel,
      level: entry.level,
      event: entry.event,
      summary: entry.summary,
      variant_id: entry.variantId ?? null,
      meta: entry.meta ?? null,
    });
  } catch {
    // The activity log must never break the work it describes.
  }
}

/*
  How far back a first-ever order poll reaches. Bounded deliberately: a shop
  connecting Shopee today does not want its entire trading history replayed
  into the ledger as fresh stock movements.
*/
const FIRST_POLL_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/*
  How much already-covered time each poll re-reads.

  Marketplace order timestamps are the PLATFORM's clock, not ours, and their
  order lists are eventually consistent — an order can become visible with a
  `create_time` slightly earlier than the cursor we set while it was still
  invisible. Without an overlap that order is never seen again by any run.
  Re-reading is free because record_channel_sale rejects the duplicate.
*/
const POLL_OVERLAP_MS = 10 * 60 * 1000;

/*
  The furthest back a single poll may ask for. Shopee's order list caps a query
  window at 15 days and TikTok's is comparable, so a longer request is rejected
  outright rather than truncated. 14 days keeps us inside both.
*/
const MAX_POLL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/*
  Listings compared per reconcile run. Each one is a separate API call against a
  rate-limited platform inside a function with a wall-clock limit, so the sweep
  is bounded and rotates oldest-checked-first via last_reconciled_at. When the
  cap truncates a run it is logged — a silent cap would read as "everything
  agrees" when most of the catalogue was never looked at.
*/
const RECONCILE_BATCH = 100;

/*
  Imports orders the platform has that we may not.

  THE CURSOR IS ONLY ADVANCED ON A CLEAN RUN. If any order in the window failed
  to import, the cursor stays where it was so the next run re-reads that window.
  Advancing past a failure would step over the one order that needed attention
  and leave the ledger permanently short — the exact drift this job exists to
  prevent.
*/
async function runPullOrders(job: ClaimedJob): Promise<void> {
  const db = admin();
  const label = CHANNEL_LABEL[job.channel];

  const { data: conn } = await db
    .from("channel_connections")
    .select("orders_polled_through")
    .eq("channel", job.channel)
    .maybeSingle();

  const now = Date.now();
  const cursor = conn?.orders_polled_through
    ? Date.parse(conn.orders_polled_through as string)
    : null;

  const wanted =
    cursor === null || Number.isNaN(cursor)
      ? now - FIRST_POLL_LOOKBACK_MS
      : cursor - POLL_OVERLAP_MS;

  const floor = now - MAX_POLL_WINDOW_MS;
  const from = Math.max(wanted, floor);

  /*
    A gap wider than the platform will answer for means orders exist that this
    poll cannot reach. Clamping silently would look like a successful catch-up,
    so say so — the operator's remedy is the CSV export, not another poll.
  */
  if (wanted < floor) {
    await log({
      channel: job.channel,
      level: "error",
      event: "poll_window_truncated",
      summary:
        `${label}: last polled ${new Date(cursor as number).toISOString().slice(0, 10)}, ` +
        `beyond the ${MAX_POLL_WINDOW_MS / 86_400_000}-day window the platform will answer for. ` +
        `Orders before ${new Date(floor).toISOString().slice(0, 10)} must be reconciled by hand.`,
      meta: { requested_from: new Date(wanted).toISOString(), clamped_to: new Date(floor).toISOString() },
    });
  }

  const since = new Date(from).toISOString();
  const orders = await adapterFor(job.channel).fetchOrders(since);

  let imported = 0;
  let duplicates = 0;
  let failed = 0;

  for (const order of orders) {
    const { data, error } = await db.rpc("record_channel_sale", {
      p_channel: job.channel,
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
      /*
        The normalized order, not a raw envelope. fetchOrders returns one order
        per element, so unlike the webhook route there is no original payload
        to preserve — recording the normalization we acted on is the honest
        substitute, and it is still what makes a mapping bug diagnosable.
      */
      p_raw: { source: "poll", order } as unknown as Record<string, unknown>,
    });

    if (error) {
      failed += 1;
      await log({
        channel: job.channel,
        level: "error",
        event: "order_import_failed",
        summary: `${label}: could not import polled order ${order.externalOrderId} — ${error.message}`,
        meta: { external_order_id: order.externalOrderId },
      });
      continue;
    }

    const r = (data ?? {}) as { applied?: boolean };
    if (r.applied) imported += 1;
    else duplicates += 1;
  }

  if (failed === 0) {
    await db.rpc("advance_order_cursor", {
      p_channel: job.channel,
      p_through: new Date(now).toISOString(),
    });
  }

  /*
    Only worth an entry when the poll actually found something. A 5-minute cron
    that logs "0 new orders" 288 times a day buries the lines that matter.
  */
  if (imported > 0 || failed > 0) {
    await log({
      channel: job.channel,
      level: failed > 0 ? "error" : "info",
      event: "orders_polled",
      summary:
        `${label}: polled ${orders.length} order(s) since ${since.slice(0, 16).replace("T", " ")} — ` +
        `${imported} imported, ${duplicates} already known` +
        (failed > 0 ? `, ${failed} failed (cursor held)` : ""),
      meta: { since, found: orders.length, imported, duplicates, failed },
    });
  }

  if (failed > 0) {
    throw new Error(`${failed} of ${orders.length} polled order(s) could not be imported`);
  }
}

/*
  Compares what the marketplace HOLDS against what we told it to hold.

  This is the only check that can catch a push we believe succeeded but which
  the platform did not apply — a 200 that silently no-ops, a listing edited in
  Seller Centre behind our back, a variation split into two. The push queue is
  blind to all of it: it records what was sent, never what landed.

  Drift is corrected through the QUEUE, not by pushing here. A direct push would
  bypass the debounce and could stampede a rate limit exactly when a reconcile
  finds many listings wrong at once — which is precisely when it is most likely.
*/
async function runReconcile(job: ClaimedJob): Promise<void> {
  const db = admin();
  const adapter = adapterFor(job.channel);
  const label = CHANNEL_LABEL[job.channel];

  const { data: listingRows, error: listingErr } = await db
    .from("channel_listings")
    .select("id, variant_id, external_item_id, external_model_id, safety_buffer")
    .eq("channel", job.channel)
    .eq("sync_enabled", true)
    /* Oldest-checked first, never-checked before that — see RECONCILE_BATCH. */
    .order("last_reconciled_at", { ascending: true, nullsFirst: true })
    .limit(RECONCILE_BATCH + 1);
  if (listingErr) throw new Error(`could not load listings: ${listingErr.message}`);

  const all = (listingRows ?? []) as {
    id: string;
    variant_id: string;
    external_item_id: string;
    external_model_id: string | null;
    safety_buffer: number | null;
  }[];

  /* One extra row was requested purely to detect truncation without a count. */
  const truncated = all.length > RECONCILE_BATCH;
  const listings = truncated ? all.slice(0, RECONCILE_BATCH) : all;
  if (listings.length === 0) return;

  const { data: variantRows, error: variantErr } = await db
    .from("product_variants")
    .select("id, sku, stock_on_hand")
    .in("id", listings.map((l) => l.variant_id));
  if (variantErr) throw new Error(`could not load variants: ${variantErr.message}`);

  const variants = new Map(
    ((variantRows ?? []) as { id: string; sku: string | null; stock_on_hand: number | null }[]).map(
      (v) => [v.id, v],
    ),
  );

  let checked = 0;
  let drifted = 0;
  let unavailable = 0;

  /* Sequential, for the same rate-limit reason drain() works jobs one at a time. */
  for (const listing of listings) {
    const variant = variants.get(listing.variant_id);
    const ours = publishableQty(variant?.stock_on_hand ?? 0, listing.safety_buffer ?? 0);

    let theirs: number | null;
    try {
      theirs = await adapter.fetchStock({
        externalItemId: listing.external_item_id,
        externalModelId: listing.external_model_id,
      });
    } catch (err) {
      /*
        One unreadable listing must not abandon the rest of the sweep. It is
        left unstamped, so the next run retries it first.
      */
      unavailable += 1;
      await log({
        channel: job.channel,
        level: "warning",
        event: "reconcile_unavailable",
        summary: `${label}: could not read ${variant?.sku ?? listing.external_item_id} — ${
          err instanceof Error ? err.message : "lookup failed"
        }`,
        variantId: listing.variant_id,
      });
      continue;
    }

    if (theirs === null) {
      unavailable += 1;
      await db.rpc("mark_listing_reconciled", { p_listing_id: listing.id, p_their_qty: null });
      continue;
    }

    checked += 1;
    await db.rpc("mark_listing_reconciled", { p_listing_id: listing.id, p_their_qty: theirs });

    if (theirs !== ours) {
      drifted += 1;
      await db.rpc("enqueue_listing_push", { p_listing_id: listing.id });
      await log({
        channel: job.channel,
        level: "warning",
        event: "stock_drift",
        summary:
          `${label}: ${variant?.sku ?? listing.external_item_id} shows ${theirs} there, ` +
          `${ours} here — correction queued`,
        variantId: listing.variant_id,
        meta: {
          theirs,
          ours,
          stock_on_hand: variant?.stock_on_hand ?? null,
          safety_buffer: listing.safety_buffer ?? 0,
        },
      });
    }
  }

  await log({
    channel: job.channel,
    level: drifted > 0 ? "warning" : "info",
    event: "reconciled",
    summary:
      `${label}: checked ${checked} listing(s), ${drifted} drifted` +
      (unavailable > 0 ? `, ${unavailable} unreadable` : "") +
      (truncated ? ` (capped at ${RECONCILE_BATCH}; the rest are checked next run)` : ""),
    meta: { checked, drifted, unavailable, truncated },
  });
}

async function runJob(job: ClaimedJob): Promise<void> {
  if (job.kind === "pull_orders") return runPullOrders(job);
  if (job.kind === "reconcile") return runReconcile(job);

  if (!job.listing_id || !job.external_item_id) {
    throw new Error("job has no listing — it was probably deleted mid-flight");
  }

  const qty = publishableQty(job.stock_on_hand ?? 0, job.safety_buffer ?? 0);

  await adapterFor(job.channel).pushStock({
    externalItemId: job.external_item_id,
    externalModelId: job.external_model_id,
    qty,
  });

  await admin().rpc("mark_listing_pushed", { p_listing_id: job.listing_id, p_qty: qty });
  await log({
    channel: job.channel,
    level: "info",
    event: "stock_pushed",
    summary: `${CHANNEL_LABEL[job.channel]}: ${job.sku ?? "listing"} set to ${qty}`,
    variantId: job.variant_id,
    meta: { qty, stock_on_hand: job.stock_on_hand, safety_buffer: job.safety_buffer },
  });
}

/*
  Queues the polling work for every ready channel, then claims a batch and
  works it.

  ENQUEUE BEFORE CLAIM, in the same invocation. The queue is the only thing the
  worker consumes, so if nothing ever inserted a pull_orders job the poll would
  never run — the job kinds have existed since the Phase 8 schema and nothing
  had ever created one. Doing it here rather than from the cron route means the
  admin's "Sync now" drives the identical path, so a manual run is a true
  rehearsal of the automated one.

  Both inserts collapse on channel_sync_jobs_pending_channel_idx, so a run that
  finds last run's poll still queued adds nothing rather than piling up.

  `reconcile` is opt-in because it is the expensive sweep — one API read per
  listing. The 5-minute lane leaves it off and only polls orders; the nightly
  Vercel cron passes it.

  Jobs are worked SEQUENTIALLY, not in parallel. Marketplace APIs rate-limit
  hard, and a burst that trips a limit costs more than the wall-clock it saved —
  the same reasoning the campaign sender uses for broadcasts.
*/
export async function drain(
  { limit = 20, reconcile = false }: { limit?: number; reconcile?: boolean } = {},
): Promise<DrainReport> {
  const { ready, skipped } = await readyChannels();
  const report: DrainReport = {
    readyChannels: ready,
    skippedChannels: skipped,
    claimed: 0,
    pushed: 0,
    polled: 0,
    reconciled: 0,
    failed: 0,
  };

  if (ready.length === 0) return report;

  for (const channel of ready) {
    /*
      A failure to enqueue must not abort the drain — there may be perfectly
      good push jobs already waiting, and refusing to work them because the
      poll could not be scheduled makes a small fault a total outage.
    */
    try {
      await admin().rpc("enqueue_channel_job", { p_channel: channel, p_kind: "pull_orders" });
      if (reconcile) {
        await admin().rpc("enqueue_channel_job", { p_channel: channel, p_kind: "reconcile" });
      }
    } catch (err) {
      await log({
        channel,
        level: "error",
        event: "enqueue_failed",
        summary: `${CHANNEL_LABEL[channel]}: could not queue polling — ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      });
    }
  }

  const { data, error } = await admin().rpc("claim_sync_jobs", {
    p_limit: limit,
    p_channels: ready,
  });
  if (error) throw new Error(`claim_sync_jobs failed: ${error.message}`);

  const jobs = (data ?? []) as ClaimedJob[];
  report.claimed = jobs.length;

  for (const job of jobs) {
    try {
      await runJob(job);
      await admin().rpc("release_sync_job", { p_job_id: job.job_id, p_ok: true });
      if (job.kind === "pull_orders") report.polled += 1;
      else if (job.kind === "reconcile") report.reconciled += 1;
      else report.pushed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "push failed";
      await admin().rpc("release_sync_job", {
        p_job_id: job.job_id,
        p_ok: false,
        p_error: message,
      });
      report.failed += 1;
      await log({
        channel: job.channel,
        level: "error",
        event: "push_failed",
        summary: `${CHANNEL_LABEL[job.channel]}: ${job.sku ?? "listing"} — ${message}`,
        variantId: job.variant_id,
        meta: { attempt: job.attempts },
      });
    }
  }

  return report;
}

/*
  Queues a resync of every mapped listing — the "Re-sync all" button, and the
  reconciliation cron's safety net for webhooks that never arrived.

  Inserts through the same debounced queue rather than pushing directly, so a
  button press during a busy period cannot stampede the marketplace APIs.
*/
export async function enqueueFullResync(channel?: Channel): Promise<number> {
  /*
    Goes through enqueue_listing_pushes rather than an upsert from here.

    This used to build the rows in TypeScript and insert them with
    `{onConflict: "listing_id", ignoreDuplicates: true}`, which PostgREST
    compiles to `on conflict (listing_id) do nothing`. The debounce index is
    PARTIAL, and Postgres will not infer a partial index as an arbiter unless
    the statement repeats its predicate — so every press of "Re-sync all"
    raised 42P10 and queued nothing at all. The trigger path was unaffected
    because it has always used a bare `on conflict do nothing`, which is what
    the function now does for both. See the migration for the full note.

    The count returned is now jobs CREATED rather than listings considered, so
    a second press during a busy period reports the 0 the debounce actually
    produced instead of claiming to have re-queued the whole catalogue.
  */
  const { data, error } = await admin().rpc("enqueue_listing_pushes", {
    p_channel: channel ?? null,
  });
  if (error) throw new Error(`enqueueFullResync failed: ${error.message}`);

  return typeof data === "number" ? data : 0;
}
