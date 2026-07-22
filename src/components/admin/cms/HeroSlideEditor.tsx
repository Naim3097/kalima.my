"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveHeroSlide, deleteHeroSlide } from "@/app/admin/actions";
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
import type { AdminHeroSlide } from "@/lib/admin";

type Props = {
  /** Existing slide to edit; omit for a new slide. */
  slide?: AdminHeroSlide;
};

/*
  Create/edit dialog for a homepage hero slide. Optional text fields are sent as
  plain strings — saveHeroSlide stores empty strings as null (focal empty →
  "center"). Renders its own trigger: "Edit" per row, "New slide" when creating.
*/
export function HeroSlideEditor({ slide }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [eyebrow, setEyebrow] = useState(slide?.eyebrow ?? "");
  const [title, setTitle] = useState(slide?.title ?? "");
  const [body, setBody] = useState(slide?.body ?? "");
  const [image, setImage] = useState(slide?.image ?? "");
  const [focal, setFocal] = useState(slide?.focal ?? "");
  const [primaryLabel, setPrimaryLabel] = useState(slide?.primaryLabel ?? "");
  const [primaryHref, setPrimaryHref] = useState(slide?.primaryHref ?? "");
  const [secondaryLabel, setSecondaryLabel] = useState(slide?.secondaryLabel ?? "");
  const [secondaryHref, setSecondaryHref] = useState(slide?.secondaryHref ?? "");
  const [sortOrder, setSortOrder] = useState(String(slide?.sortOrder ?? 0));
  const [active, setActive] = useState(slide?.active ?? true);

  function reset() {
    setEyebrow(slide?.eyebrow ?? "");
    setTitle(slide?.title ?? "");
    setBody(slide?.body ?? "");
    setImage(slide?.image ?? "");
    setFocal(slide?.focal ?? "");
    setPrimaryLabel(slide?.primaryLabel ?? "");
    setPrimaryHref(slide?.primaryHref ?? "");
    setSecondaryLabel(slide?.secondaryLabel ?? "");
    setSecondaryHref(slide?.secondaryHref ?? "");
    setSortOrder(String(slide?.sortOrder ?? 0));
    setActive(slide?.active ?? true);
  }

  function submit() {
    if (!title.trim()) {
      toast.error("Title is required.");
      return;
    }
    if (!image.trim()) {
      toast.error("Image path is required.");
      return;
    }
    startTransition(async () => {
      const res = await saveHeroSlide({
        id: slide?.id,
        eyebrow,
        title,
        body,
        image,
        focal,
        primaryLabel,
        primaryHref,
        secondaryLabel,
        secondaryHref,
        sortOrder: Math.round(Number(sortOrder) || 0),
        active,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(slide ? "Slide updated." : "Slide created.");
      setOpen(false);
      if (!slide) reset();
    });
  }

  function remove() {
    if (!slide) return;
    startTransition(async () => {
      const res = await deleteHeroSlide(slide.id);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Slide deleted.");
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
        {slide ? (
          <Button variant="kalimaOutline" size="sm" className="cursor-pointer">
            Edit
          </Button>
        ) : (
          <Button variant="kalima" size="editorial" className="cursor-pointer px-4 py-2.5">
            New slide
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] overflow-y-auto border-navy/10">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-navy">
            {slide ? "Edit hero slide" : "New hero slide"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="hero-eyebrow" className="label-caps text-navy-400">
              Eyebrow
            </Label>
            <Input
              id="hero-eyebrow"
              value={eyebrow}
              onChange={(e) => setEyebrow(e.target.value)}
              placeholder="New arrivals"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="hero-title" className="label-caps text-navy-400">
              Title
            </Label>
            <Input
              id="hero-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="The Raya edit"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="hero-body" className="label-caps text-navy-400">
              Body
            </Label>
            <Textarea
              id="hero-body"
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Soft-tailored silhouettes for the festive season."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="hero-image" className="label-caps text-navy-400">
                Image path
              </Label>
              <Input
                id="hero-image"
                value={image}
                onChange={(e) => setImage(e.target.value)}
                placeholder="/products/maya-chiffon.jpg"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hero-focal" className="label-caps text-navy-400">
                Focal point
              </Label>
              <Input
                id="hero-focal"
                value={focal}
                onChange={(e) => setFocal(e.target.value)}
                placeholder="center 30%"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="hero-plabel" className="label-caps text-navy-400">
                Primary label
              </Label>
              <Input
                id="hero-plabel"
                value={primaryLabel}
                onChange={(e) => setPrimaryLabel(e.target.value)}
                placeholder="Shop the edit"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hero-phref" className="label-caps text-navy-400">
                Primary link
              </Label>
              <Input
                id="hero-phref"
                value={primaryHref}
                onChange={(e) => setPrimaryHref(e.target.value)}
                placeholder="/collections/raya"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="hero-slabel" className="label-caps text-navy-400">
                Secondary label
              </Label>
              <Input
                id="hero-slabel"
                value={secondaryLabel}
                onChange={(e) => setSecondaryLabel(e.target.value)}
                placeholder="Our story"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hero-shref" className="label-caps text-navy-400">
                Secondary link
              </Label>
              <Input
                id="hero-shref"
                value={secondaryHref}
                onChange={(e) => setSecondaryHref(e.target.value)}
                placeholder="/pages/about"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="hero-order" className="label-caps text-navy-400">
              Sort order
            </Label>
            <Input
              id="hero-order"
              type="number"
              step={1}
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              placeholder="0"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-navy">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="size-4 accent-navy"
            />
            Active
          </label>
        </div>

        <div className="flex items-center justify-between pt-2">
          <div>
            {slide && (
              <Button
                variant="kalimaOutline"
                size="sm"
                className="cursor-pointer border-red-300 text-red-700 hover:bg-red-50"
                onClick={remove}
                disabled={pending}
              >
                Delete
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
              {pending ? "Saving…" : slide ? "Save changes" : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
