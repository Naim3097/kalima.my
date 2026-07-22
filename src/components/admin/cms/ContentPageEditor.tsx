"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveContentPage } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AdminContentPage } from "@/lib/admin";

type Props = {
  /** Existing page to edit; omit for a new page. */
  page?: AdminContentPage;
};

/*
  Create/edit dialog for a storefront content page. The body is stored as an
  array of paragraph strings: we join with a blank line ("\n\n") for the
  textarea, and on save split on blank lines back into paragraphs (trimming
  empties). Renders its own trigger: "Edit" per row, "New page" when creating.
*/
export function ContentPageEditor({ page }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [slug, setSlug] = useState(page?.slug ?? "");
  const [title, setTitle] = useState(page?.title ?? "");
  const [body, setBody] = useState((page?.body ?? []).join("\n\n"));
  const [published, setPublished] = useState(page?.published ?? false);

  function reset() {
    setSlug(page?.slug ?? "");
    setTitle(page?.title ?? "");
    setBody((page?.body ?? []).join("\n\n"));
    setPublished(page?.published ?? false);
  }

  function submit() {
    if (!title.trim()) {
      toast.error("Title is required.");
      return;
    }
    // Split on blank lines → one paragraph per block; drop empty blocks.
    const paragraphs = body
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);

    startTransition(async () => {
      const res = await saveContentPage({
        id: page?.id,
        slug: slug.trim(),
        title: title.trim(),
        body: paragraphs,
        published,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(page ? "Page updated." : "Page created.");
      setOpen(false);
      if (!page) {
        setSlug("");
        setTitle("");
        setBody("");
        setPublished(false);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) reset();
      }}
    >
      <DialogTrigger asChild>
        {page ? (
          <Button variant="kalimaOutline" size="sm" className="cursor-pointer">
            Edit
          </Button>
        ) : (
          <Button variant="kalima" size="editorial" className="cursor-pointer px-4 py-2.5">
            New page
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] overflow-y-auto border-navy/10">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-navy">
            {page ? "Edit page" : "New content page"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="page-slug" className="label-caps text-navy-400">
                Slug
              </Label>
              <Input
                id="page-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                placeholder="about-us"
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="page-title" className="label-caps text-navy-400">
                Title
              </Label>
              <Input
                id="page-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="About us"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="page-body" className="label-caps text-navy-400">
              Body
            </Label>
            <Textarea
              id="page-body"
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={"First paragraph.\n\nSecond paragraph."}
            />
            <p className="text-[12px] text-navy-400">
              Separate paragraphs with a blank line.
            </p>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-navy">
            <input
              type="checkbox"
              checked={published}
              onChange={(e) => setPublished(e.target.checked)}
              className="size-4 accent-navy"
            />
            Published
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="kalimaOutline"
            size="sm"
            className="cursor-pointer"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            variant="kalima"
            size="sm"
            className="cursor-pointer"
            onClick={submit}
            disabled={pending}
          >
            {pending ? "Saving…" : page ? "Save changes" : "Create"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
