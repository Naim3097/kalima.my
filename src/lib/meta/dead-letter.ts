import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { postEvent } from "@/lib/meta/capi";

/*
  Conversions that Meta has not acknowledged yet.

  WRITE-AHEAD, NOT WRITE-ON-FAILURE, and the difference is the whole point.
  Purchase fires from runPaidSideEffects, which runs ONLY on the transition to
  paid — markOrderPaid is idempotent, so a redelivered webhook returns
  "already_paid" and the side effects never run a second time. That gives the
  Purchase event exactly one chance. If the process is killed mid-send — a
  lambda timeout, an instance recycled — a catch block never executes and the
  conversion vanishes with nothing anywhere to say it existed.

  So the payload is written BEFORE the send and removed after it succeeds. A row
  left behind is an event Meta has not confirmed, whatever killed the attempt.

  NOT FOR BROWSING EVENTS. A ViewContent costs two database writes under this
  scheme and is worth approximately nothing individually — the shopper is on the
  page, another will follow, and the funnel is measured in aggregate. Only
  Purchase and AddPaymentInfo, which represent money and cannot be re-fired,
  earn the round trips.
*/

/*
  FORTY-EIGHT HOURS, WHICH IS NOT META'S SEVEN.

  Meta accepts an event whose event_time is up to seven days old, and
  deduplicates identical (event_name, event_id) pairs for FORTY-EIGHT. Those are
  different numbers and confusing them is expensive in one specific way: if the
  original POST actually reached Meta but the response was lost, a retry inside
  48 hours is silently deduplicated, and a retry on day three is counted as a
  second sale. Reported revenue goes up and nobody can explain why.

  So the retry window is the dedup window, and a row past it is deleted rather
  than sent. A lost conversion is a gap; a duplicated one is a lie.
*/
const RETRY_WINDOW_MS = 48 * 60 * 60 * 1000;

/** How many rows one drain will attempt. Small — this runs alongside real work. */
const DRAIN_BATCH = 20;

function db() {
  return createAdminClient();
}

/*
  Records the intent to send, returning the row id to clear afterwards.

  Returns null when it could not be written, which is not a reason to skip the
  send — an unrecorded event that reaches Meta is a better outcome than no event
  at all. The caller sends either way.
*/
async function reserve(eventName: string, event: Record<string, unknown>): Promise<string | null> {
  try {
    const client = db();
    if (!client) return null;

    const { data, error } = await client
      .from("capi_dead_letter")
      .insert({
        event_name: eventName,
        payload: event,
        expires_at: new Date(Date.now() + RETRY_WINDOW_MS).toISOString(),
      })
      .select("id")
      .single();

    return error ? null : (data?.id as string);
  } catch {
    return null;
  }
}

async function clear(id: string): Promise<void> {
  try {
    await db()?.from("capi_dead_letter").delete().eq("id", id);
  } catch {
    /* A row that outlives its successful send is retried once inside the dedup
       window and discarded by Meta. Harmless; a throw here would not be. */
  }
}

async function recordFailure(id: string, message: string): Promise<void> {
  try {
    const client = db();
    if (!client) return;
    const { data } = await client
      .from("capi_dead_letter")
      .select("attempts")
      .eq("id", id)
      .single();
    await client
      .from("capi_dead_letter")
      .update({ attempts: ((data?.attempts as number) ?? 0) + 1, last_error: message.slice(0, 500) })
      .eq("id", id);
  } catch {
    /* Best effort — the row still exists, which is what makes the retry work. */
  }
}

/*
  Sends an event that must not be lost.

  Never throws. Every caller is a side effect on a path that matters more than
  analytics, and the return value is for logging, not for control flow.
*/
export async function sendDurable(
  eventName: string,
  event: Record<string, unknown>,
): Promise<boolean> {
  const id = await reserve(eventName, event);

  try {
    await postEvent(event);
    if (id) await clear(id);
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    console.error(`[capi] ${eventName} rejected by Meta:`, message);
    if (id) await recordFailure(id, message);
    return false;
  }
}

export type DrainReport = { attempted: number; sent: number; expired: number; failed: number };

/*
  Retries what is still owed, and drops what can no longer be sent honestly.

  Called from the daily cron ride-along, and cheap enough to be worth calling
  opportunistically wherever a real send is already happening.

  EXPIRED ROWS ARE DELETED, NOT SENT. Past the dedup window a retry can double
  count, and past seven days Meta rejects the entire request — so one stale row
  batched with healthy ones would take them down with it. Deleting is the only
  answer that is both honest and safe.
*/
export async function drainDeadLetter(): Promise<DrainReport> {
  const report: DrainReport = { attempted: 0, sent: 0, expired: 0, failed: 0 };

  const client = db();
  if (!client) return report;

  try {
    const nowIso = new Date().toISOString();

    const { data: expired } = await client
      .from("capi_dead_letter")
      .delete()
      .lt("expires_at", nowIso)
      .select("id");
    report.expired = expired?.length ?? 0;

    const { data: rows } = await client
      .from("capi_dead_letter")
      .select("id, event_name, payload")
      .gte("expires_at", nowIso)
      .order("created_at", { ascending: true })
      .limit(DRAIN_BATCH);

    /* Sequentially and one event per request: a batch is rejected whole if any
       member of it is invalid, which would let one bad row bury the rest. */
    for (const row of rows ?? []) {
      report.attempted++;
      try {
        await postEvent(row.payload as Record<string, unknown>);
        await clear(row.id as string);
        report.sent++;
      } catch (e) {
        report.failed++;
        await recordFailure(row.id as string, e instanceof Error ? e.message : "unknown error");
      }
    }
  } catch (e) {
    console.error("[capi] dead-letter drain failed:", e instanceof Error ? e.message : e);
  }

  return report;
}
