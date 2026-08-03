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
  pushed: number;
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

async function runJob(job: ClaimedJob): Promise<void> {
  if (job.kind !== "push_stock") {
    // pull_orders / reconcile arrive with the adapters; until then a claimed
    // job of that kind is a no-op rather than a failure, so it does not retry.
    return;
  }
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
  Claims a batch and works it.

  Jobs are worked SEQUENTIALLY, not in parallel. Marketplace APIs rate-limit
  hard, and a burst that trips a limit costs more than the wall-clock it saved —
  the same reasoning the campaign sender uses for broadcasts.
*/
export async function drain(limit = 20): Promise<DrainReport> {
  const { ready, skipped } = await readyChannels();
  const report: DrainReport = {
    readyChannels: ready,
    skippedChannels: skipped,
    claimed: 0,
    pushed: 0,
    failed: 0,
  };

  if (ready.length === 0) return report;

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
      report.pushed += 1;
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
  const query = admin().from("channel_listings").select("id, channel").eq("sync_enabled", true);
  const { data, error } = channel ? await query.eq("channel", channel) : await query;
  if (error) throw new Error(`enqueueFullResync failed: ${error.message}`);

  const rows = (data ?? []) as { id: string; channel: Channel }[];
  if (rows.length === 0) return 0;

  /*
    The partial unique index makes a listing that already has queued work a
    no-op, so this is safe to press repeatedly.
  */
  const { error: insertErr } = await admin()
    .from("channel_sync_jobs")
    .upsert(
      rows.map((r) => ({ channel: r.channel, kind: "push_stock" as const, listing_id: r.id })),
      { onConflict: "listing_id", ignoreDuplicates: true },
    );
  if (insertErr) throw new Error(`enqueueFullResync insert failed: ${insertErr.message}`);

  return rows.length;
}
