"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
  setInstagramPostHidden,
  syncInstagramNow,
  tagInstagramPost,
} from "@/app/admin/actions";
import ProductImage from "@/components/brand/ProductImage";
import { Table, Td, Tr } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AdminInstagramPost, TaggableProduct } from "@/lib/admin";

/*
  The synced Instagram feed, as the back office sees it.

  Nothing here creates or edits a post — Instagram is the source, and the sync
  is what writes rows. The two things staff decide are:

    TAG    which product a tile should open. Untagged tiles open the post on
           Instagram instead, which is the honest default but sends the visitor
           to another app.
    HIDE   whether a post belongs on the storefront at all. Hiding rather than
           deleting, because the next sync would simply fetch a deleted row
           again — `hidden` is the only thing that survives a refresh.

  Each control saves on change. There is no Save button because there is no form:
  every row is one independent decision, and batching them behind a submit would
  only invent a way to lose half of them.
*/

const UNTAGGED = "__none__"; // Select cannot hold an empty string as a value

export function InstagramPosts({
  posts,
  products,
}: {
  posts: AdminInstagramPost[];
  products: TaggableProduct[];
}) {
  const [pending, startTransition] = useTransition();

  function tag(postId: string, value: string) {
    const productId = value === UNTAGGED ? null : value;
    startTransition(async () => {
      const res = await tagInstagramPost(postId, productId);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(productId ? "Post tagged." : "Tag cleared.");
    });
  }

  function toggleHidden(post: AdminInstagramPost) {
    startTransition(async () => {
      const res = await setInstagramPostHidden(post.id, !post.hidden);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(post.hidden ? "Back on the storefront." : "Hidden from the storefront.");
    });
  }

  function refresh() {
    startTransition(async () => {
      const res = await syncInstagramNow();
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      const s = res.summary;
      toast.success(
        s
          ? `${s.added} new, ${s.updated} updated, ${s.pruned} removed.`
          : "Instagram refreshed.",
      );
    });
  }

  if (posts.length === 0) {
    return (
      <div className="px-5 py-10 text-center">
        <p className="text-[13px] text-navy-400">
          No posts pulled yet. The feed refreshes daily — or fetch it now.
        </p>
        <Button
          variant="kalimaOutline"
          size="sm"
          className="mt-4 cursor-pointer"
          onClick={refresh}
          disabled={pending}
        >
          {pending ? "Fetching…" : "Refresh from Instagram"}
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-navy/10 px-5 pb-4">
        <p className="text-[13px] tracking-wide text-navy-400">
          Pulled from Instagram daily. Tag a post to send its tile to a product page — untagged
          tiles open the post on Instagram.
        </p>
        <Button
          variant="kalimaOutline"
          size="sm"
          className="ml-4 shrink-0 cursor-pointer"
          onClick={refresh}
          disabled={pending}
        >
          {pending ? "Working…" : "Refresh now"}
        </Button>
      </div>

      <Table head={["Post", "Posted", "Links to", "On storefront", ""]}>
        {posts.map((post) => (
          <Tr key={post.id}>
            <Td className="whitespace-normal">
              <div className="flex items-center gap-3">
                <div className="relative h-12 w-10 shrink-0 overflow-hidden rounded bg-navy-100">
                  <ProductImage
                    image={post.image}
                    tone="#efe7db"
                    alt={post.caption ?? "Instagram post"}
                    sizes="40px"
                    className="object-cover"
                  />
                </div>
                <p className="line-clamp-2 max-w-xs text-[12px] text-navy-400">
                  {post.caption?.split("\n")[0] || "—"}
                </p>
              </div>
            </Td>
            <Td className="text-[12px] text-navy-400">
              {new Date(post.postedAt).toLocaleDateString("en-MY", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </Td>
            <Td>
              <Select
                value={post.productId ?? UNTAGGED}
                onValueChange={(v) => tag(post.id, v)}
                disabled={pending}
              >
                <SelectTrigger className="w-52 cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNTAGGED}>Instagram post</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Td>
            <Td>
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-navy">
                <input
                  type="checkbox"
                  checked={!post.hidden}
                  onChange={() => toggleHidden(post)}
                  disabled={pending}
                  className="size-4 accent-navy"
                />
                {post.hidden ? "Hidden" : "Shown"}
              </label>
            </Td>
            <Td className="text-right">
              <a
                href={post.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] tracking-wide text-navy-400 underline-offset-4 hover:text-navy hover:underline"
              >
                View on Instagram
              </a>
            </Td>
          </Tr>
        ))}
      </Table>
    </>
  );
}
