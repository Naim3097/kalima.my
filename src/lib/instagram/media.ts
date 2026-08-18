import "server-only";

import { GRAPH, metaInstagramId, metaPageToken } from "@/lib/channels/meta";

/*
  Reads the shop's own Instagram media through the Graph API.

  Same app, same pinned Graph version and same Page token as the unified inbox
  (src/lib/channels/meta.ts) — but a DIFFERENT permission: messaging needs
  `instagram_business_manage_messages`, reading media needs `instagram_basic`.
  A token that runs the inbox perfectly can still be refused here, which is why
  the error is surfaced verbatim rather than swallowed as "no posts".

  Read-only and deliberately small: fetch the latest media, normalise it to one
  usable still image per post. Everything about storing it lives in sync.ts.
*/

/** How many posts the homepage strip holds. Also the prune window. */
export const MEDIA_LIMIT = 24;

export type InstagramMedia = {
  id: string;
  permalink: string;
  caption: string | null;
  mediaType: string;
  /** The still to show. Already resolved for albums and videos. */
  imageUrl: string;
  postedAt: string;
};

type RawChild = { media_type?: string; media_url?: string; thumbnail_url?: string };
type RawMedia = {
  id?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  caption?: string;
  timestamp?: string;
  children?: { data?: RawChild[] };
};

/*
  One still per post, whatever Meta returned.

    IMAGE           → media_url
    VIDEO / REEL    → thumbnail_url (media_url is the mp4)
    CAROUSEL_ALBUM  → the first child's still — an album carries NO media_url of
                      its own, and reading media_url straight off it is how this
                      ends up rendering blank tiles for exactly the posts with
                      the most photographs in them.
*/
function stillFor(media: RawMedia): string | null {
  if (media.media_type === "CAROUSEL_ALBUM") {
    const first = media.children?.data?.[0];
    if (!first) return null;
    return first.media_type === "VIDEO" ? first.thumbnail_url ?? null : first.media_url ?? null;
  }
  if (media.media_type === "VIDEO") return media.thumbnail_url ?? null;
  return media.media_url ?? null;
}

export class InstagramNotConfigured extends Error {
  constructor() {
    super("Instagram is not configured — META_INSTAGRAM_ID and META_PAGE_TOKEN are required.");
    this.name = "InstagramNotConfigured";
  }
}

/** True when there is enough configuration to even attempt a fetch. */
export function instagramConfigured(): boolean {
  return Boolean(metaInstagramId() && metaPageToken());
}

/*
  The latest posts, newest first.

  Posts with no usable still are dropped rather than stored half-formed: a row
  whose image cannot be resolved is a broken tile waiting to be rendered.
*/
export async function fetchRecentMedia(limit = MEDIA_LIMIT): Promise<InstagramMedia[]> {
  const igId = metaInstagramId();
  const token = metaPageToken();
  if (!igId || !token) throw new InstagramNotConfigured();

  const fields = [
    "id",
    "media_type",
    "media_url",
    "thumbnail_url",
    "permalink",
    "caption",
    "timestamp",
    "children{media_type,media_url,thumbnail_url}",
  ].join(",");

  const res = await fetch(`${GRAPH}/${igId}/media?fields=${fields}&limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const json = (await res.json().catch(() => ({}))) as {
    data?: RawMedia[];
    error?: { message?: string; code?: number };
  };

  if (!res.ok) {
    /*
      Meta's own wording, verbatim. "(#200) Requires instagram_basic" tells a
      staff member exactly which permission to add; "Instagram sync failed"
      tells them nothing and sends them here to read the code.
    */
    throw new Error(json.error?.message ?? `Instagram media fetch failed (${res.status})`);
  }

  const out: InstagramMedia[] = [];
  for (const media of json.data ?? []) {
    const imageUrl = stillFor(media);
    if (!media.id || !media.permalink || !media.timestamp || !imageUrl) continue;
    out.push({
      id: media.id,
      permalink: media.permalink,
      caption: media.caption?.trim() || null,
      mediaType: media.media_type ?? "IMAGE",
      imageUrl,
      postedAt: media.timestamp,
    });
  }

  return out;
}
