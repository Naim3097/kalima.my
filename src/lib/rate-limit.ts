import "server-only";

import { headers } from "next/headers";

/*
  A small in-process throttle for the unauthenticated surfaces.

  WHAT THIS IS HONESTLY WORTH. The counter lives in the module scope of one
  serverless instance, so it is per-instance and it dies with the instance. It
  will not stop a determined distributed attacker, and it is not a substitute
  for a shared store (Upstash, Vercel KV) if abuse ever becomes real.

  What it DOES stop is the thing these endpoints are actually exposed to: one
  caller in a loop. `checkDiscount` is an unauthenticated oracle that will
  confirm whether any string is a live promo code; `placeOrder` writes a real
  row and sends real mail from our verified domain; the newsletter form inserts
  a consent record for any address typed into it. Each of those is free and
  unlimited without this, and each becomes tedious with it. That is the whole
  claim — a speed bump, chosen because the alternative on the table was nothing.

  Fails OPEN by design. A throttle that throws is a checkout that is down, and
  the failure it protects against is nuisance rather than compromise.
*/

type Window = { count: number; resetAt: number };

const buckets = new Map<string, Window>();

/*
  Bounded so a flood of distinct keys cannot itself become the memory leak.
  When the map is full we drop everything already expired, and if that frees
  nothing we drop the map — losing counters is acceptable here in a way that
  unbounded growth is not.
*/
const MAX_KEYS = 10_000;

function sweep(now: number) {
  for (const [k, w] of buckets) if (w.resetAt <= now) buckets.delete(k);
  if (buckets.size >= MAX_KEYS) buckets.clear();
}

/**
 * Records one hit against `key`. Returns false when the caller is over budget.
 */
export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size >= MAX_KEYS) sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  existing.count += 1;
  return existing.count <= limit;
}

/*
  Best-effort caller identity.

  x-forwarded-for is spoofable in general, but on Vercel the left-most entry is
  written by the platform, and an attacker who rotates it is doing more work
  than the endpoint is worth. Everything collapses to one shared bucket when no
  header is present, which is the safe direction: a missing header must not mint
  an unlimited new identity per request.
*/
export async function callerKey(scope: string): Promise<string> {
  const h = await headers();
  const ip =
    h.get("x-real-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  return `${scope}:${ip}`;
}
