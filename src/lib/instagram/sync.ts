import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { fetchRecentMedia, InstagramNotConfigured, MEDIA_LIMIT } from "@/lib/instagram/media";

/*
  Pulls the shop's latest Instagram posts into instagram_posts, mirroring each
  photograph into our own Storage bucket.

  WHY MIRROR AT ALL. Instagram's media URLs are signed and expire — days, not
  months, and not on a schedule anyone publishes. Storing the CDN URL gives a
  section that looks fine the day it is built and is full of broken tiles by the
  end of the week. Copying the bytes once also means the homepage keeps
  rendering when Meta's API is down or the token lapses, and that every image on
  the storefront comes from a host next.config.ts already allows.

  Runs service-role: it writes rows the public may read, and uploads objects,
  neither of which is a user action.

  Idempotent by construction — a post already held is updated in place and its
  bytes are never fetched twice. Running it back to back changes nothing.
*/

const BUCKET = "product-images";
const FOLDER = "instagram";
/* Matches the ceiling the upload actions enforce; Instagram stills are well
   under it, so hitting this means something is wrong, not merely large. */
const MAX_BYTES = 5 * 1024 * 1024;

export type InstagramSyncSummary = {
  fetched: number;
  added: number;
  updated: number;
  pruned: number;
  /* Posts that could not be mirrored. Reported rather than thrown: one
     unreachable image should not cost the other twenty-three their sync. */
  failed: number;
};

type Stored = { id: string; storage_path: string; posted_at: string };

function db(): SupabaseClient {
  const client = createAdminClient();
  if (!client) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set — Instagram sync requires it.");
  return client;
}

/*
  Copies one Instagram still into our bucket and returns its public URL.

  The object key is the Instagram media id, so re-running cannot accumulate
  duplicate copies of the same photograph, and `upsert` lets a re-sync of an
  edited post overwrite cleanly.
*/
async function mirror(
  client: SupabaseClient, mediaId: string, sourceUrl: string,
): Promise<{ image: string; storagePath: string } | null> {
  const res = await fetch(sourceUrl, { cache: "no-store" });
  if (!res.ok) return null;

  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  if (!contentType.startsWith("image/")) return null;

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) return null;

  const storagePath = `${FOLDER}/${mediaId}.jpg`;
  const { error } = await client.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: "image/jpeg", upsert: true });
  if (error) return null;

  const { data } = client.storage.from(BUCKET).getPublicUrl(storagePath);
  if (!data?.publicUrl) return null;

  return { image: data.publicUrl, storagePath };
}

export async function syncInstagram(): Promise<InstagramSyncSummary> {
  const client = db();
  const media = await fetchRecentMedia(MEDIA_LIMIT);

  const { data: existingRows, error: readError } = await client
    .from("instagram_posts")
    .select("id, storage_path, posted_at");
  if (readError) throw new Error(`Instagram sync failed to read stored posts: ${readError.message}`);

  const existing = new Map((existingRows ?? []).map((r) => [r.id, r as Stored]));
  const summary: InstagramSyncSummary = { fetched: media.length, added: 0, updated: 0, pruned: 0, failed: 0 };

  for (const post of media) {
    const held = existing.get(post.id);

    if (held) {
      /*
        Already mirrored. Only the mutable metadata is refreshed — captions get
        edited — and the bytes are left alone, which is what keeps a daily sync
        from re-downloading the whole strip every night.
      */
      const { error } = await client
        .from("instagram_posts")
        .update({ permalink: post.permalink, caption: post.caption, media_type: post.mediaType })
        .eq("id", post.id);
      if (error) summary.failed++;
      else summary.updated++;
      continue;
    }

    const mirrored = await mirror(client, post.id, post.imageUrl);
    if (!mirrored) {
      summary.failed++;
      continue;
    }

    const { error } = await client.from("instagram_posts").insert({
      id: post.id,
      permalink: post.permalink,
      caption: post.caption,
      media_type: post.mediaType,
      image: mirrored.image,
      storage_path: mirrored.storagePath,
      posted_at: post.postedAt,
    });
    if (error) summary.failed++;
    else summary.added++;
  }

  summary.pruned = await prune(client, media.map((m) => m.id), media.map((m) => m.postedAt), existing);
  return summary;
}

/*
  Drops posts that are no longer on Instagram — deleted or archived — so the
  storefront stops showing what the account no longer shows. Their mirrored
  objects go with them; keeping the bytes of a post someone took down is
  precisely what Meta's platform terms do not want, and it is not what the shop
  wants either.

  BOUNDED BY THE FETCH WINDOW, and that bound is the whole safety of this step.
  Only rows NEWER than the oldest post we just saw are candidates: anything
  older simply fell off the end of a `limit=24` read and is not missing at all.
  An empty or truncated API response therefore prunes nothing rather than
  emptying the table.
*/
async function prune(
  client: SupabaseClient,
  fetchedIds: string[],
  fetchedTimestamps: string[],
  existing: Map<string, Stored>,
): Promise<number> {
  if (fetchedIds.length === 0) return 0;

  const seen = new Set(fetchedIds);
  const oldestFetched = fetchedTimestamps
    .map((t) => new Date(t).getTime())
    .reduce((a, b) => Math.min(a, b));

  const stale = [...existing.values()].filter(
    (row) => !seen.has(row.id) && new Date(row.posted_at).getTime() > oldestFetched,
  );
  if (stale.length === 0) return 0;

  const { error } = await client
    .from("instagram_posts")
    .delete()
    .in("id", stale.map((r) => r.id));
  if (error) return 0;

  // Best effort: an orphaned object costs storage, a throw costs the sync.
  await client.storage
    .from(BUCKET)
    .remove(stale.map((r) => r.storage_path))
    .catch(() => {});

  return stale.length;
}

export { InstagramNotConfigured };
