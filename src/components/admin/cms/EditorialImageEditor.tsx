"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { resetEditorialImage, saveEditorialImage } from "@/app/admin/actions";
import {
  CmsImageField,
  SPOTLIGHT_FRAMES,
  TILE_FRAMES,
} from "@/components/admin/cms/CmsImageField";
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
import type { AdminEditorialImage } from "@/lib/admin";

/*
  Edit dialog for one homepage editorial slot — a category tile or the
  collection spotlight.

  Only the photograph and its framing. The label, the link and where the tile
  sits on the page are layout, and layout lives in the component: an editor that
  can retitle "Women" to something the /collections/women page does not sell is
  offering a way to make the homepage lie.

  A slot has no row until it is first changed, so there is no create/edit
  distinction here — Save upserts. Reset deletes the row, handing the slot back
  to the shot the code picks, and is offered only when there is a row to delete.
*/
export function EditorialImageEditor({ shot }: { shot: AdminEditorialImage }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [image, setImage] = useState(shot.image);
  const [focal, setFocal] = useState(shot.focal);
  const [zoom, setZoom] = useState(shot.zoom);
  const [alt, setAlt] = useState(shot.alt);

  function reset() {
    setImage(shot.image);
    setFocal(shot.focal);
    setZoom(shot.zoom);
    setAlt(shot.alt);
  }

  function submit() {
    if (!image.trim()) {
      toast.error("Upload an image, or enter an image path.");
      return;
    }
    startTransition(async () => {
      const res = await saveEditorialImage({ slot: shot.slot, image, focal, zoom, alt });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Homepage image updated.");
      setOpen(false);
    });
  }

  function restoreDefault() {
    startTransition(async () => {
      const res = await resetEditorialImage(shot.slot);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Back to the default shot.");
      setOpen(false);
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
        <Button variant="kalimaOutline" size="sm" className="cursor-pointer">
          Edit
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] overflow-y-auto border-navy/10">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-navy">{shot.label}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <CmsImageField
            image={image}
            focal={focal}
            zoom={zoom}
            disabled={pending}
            folder="editorial"
            frames={shot.slot === "spotlight" ? SPOTLIGHT_FRAMES : TILE_FRAMES}
            onImageChange={setImage}
            onFocalChange={setFocal}
            onZoomChange={setZoom}
          />

          <div className="space-y-2">
            <Label htmlFor={`editorial-alt-${shot.slot}`} className="label-caps text-navy-400">
              Alt text
            </Label>
            <Input
              id={`editorial-alt-${shot.slot}`}
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              placeholder="What the photograph shows"
            />
            <p className="text-[12px] tracking-wide text-navy-400">
              Read aloud by screen readers, and shown if the photo fails to load.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <div>
            {/* Nothing to restore until this slot has actually been changed. */}
            {shot.customised && (
              <Button
                variant="kalimaOutline"
                size="sm"
                className="cursor-pointer"
                onClick={restoreDefault}
                disabled={pending}
              >
                Restore default
              </Button>
            )}
          </div>
          <div className="flex gap-2">
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
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
