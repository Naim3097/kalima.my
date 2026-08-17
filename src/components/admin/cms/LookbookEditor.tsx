"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveLookbookShot, deleteLookbookShot } from "@/app/admin/actions";
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
import type { AdminLookbookShot, LookbookCandidate } from "@/lib/admin";

type Props = {
  /** Existing shot to edit; omit for a new one. */
  shot?: AdminLookbookShot;
  /** Published products with the colourways that have a photograph. */
  candidates: LookbookCandidate[];
};

/*
  Create/edit dialog for a homepage Lookbook tile.

  Two selects rather than an image field, because a shot names a PRODUCT and one
  of its colourways — the photograph is resolved from product_images when the
  homepage renders. That is what stops a tile outliving the colour it shows; the
  version this replaced built image URLs by path convention and went on happily
  displaying an Anna Top print the catalogue had dropped.

  The colourway list is scoped to colours that actually have a photo, so an
  unrenderable shot cannot be created in the first place.
*/
export function LookbookEditor({ shot, candidates }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [productId, setProductId] = useState(shot?.productId ?? "");
  const [colorName, setColorName] = useState(shot?.colorName ?? "");
  const [alt, setAlt] = useState(shot?.alt ?? "");
  const [sortOrder, setSortOrder] = useState(String(shot?.sortOrder ?? 0));
  const [active, setActive] = useState(shot?.active ?? true);

  const colours = useMemo(
    () => candidates.find((c) => c.id === productId)?.colors ?? [],
    [candidates, productId],
  );

  function reset() {
    setProductId(shot?.productId ?? "");
    setColorName(shot?.colorName ?? "");
    setAlt(shot?.alt ?? "");
    setSortOrder(String(shot?.sortOrder ?? 0));
    setActive(shot?.active ?? true);
  }

  /*
    Changing product clears the colourway: the old colour almost certainly does
    not exist on the new product, and silently keeping it would save a shot with
    no photograph — the one state the picker exists to prevent.
  */
  function pickProduct(id: string) {
    setProductId(id);
    const next = candidates.find((c) => c.id === id)?.colors ?? [];
    setColorName(next.includes(colorName) ? colorName : (next[0] ?? ""));
  }

  function submit() {
    if (!productId) {
      toast.error("Choose a product.");
      return;
    }
    if (!colorName) {
      toast.error("Choose a colourway.");
      return;
    }
    startTransition(async () => {
      const res = await saveLookbookShot({
        id: shot?.id,
        productId,
        colorName,
        alt,
        sortOrder: Math.round(Number(sortOrder) || 0),
        active,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(shot ? "Lookbook shot updated." : "Lookbook shot added.");
      setOpen(false);
      if (!shot) {
        setProductId("");
        setColorName("");
        setAlt("");
        setSortOrder("0");
        setActive(true);
      }
    });
  }

  function remove() {
    if (!shot) return;
    startTransition(async () => {
      const res = await deleteLookbookShot(shot.id);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Lookbook shot removed.");
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
      {/*
        DialogTrigger asChild, matching AnnouncementEditor — one trigger picking
        between the row's "Edit" and the card's "New shot".

        The first version rendered a plain Button as a direct child of Dialog and
        flipped `open` itself, on the mistaken belief that one component serving
        both buttons could not share a trigger. It can, and letting Radix own the
        trigger keeps its focus and open-state bookkeeping intact.
      */}
      <DialogTrigger asChild>
        {shot ? (
          <Button variant="kalimaOutline" size="sm" className="cursor-pointer">
            Edit
          </Button>
        ) : (
          <Button variant="kalima" size="editorial" className="cursor-pointer px-4 py-2.5">
            New shot
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="border-navy/10">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-navy">
            {shot ? "Edit Lookbook shot" : "New Lookbook shot"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="lb-product" className="label-caps text-navy-400">
              Product
            </Label>
            <select
              id="lb-product"
              value={productId}
              onChange={(e) => pickProduct(e.target.value)}
              className="w-full cursor-pointer rounded border border-navy/20 bg-white px-3 py-2 text-[14px] text-navy"
            >
              <option value="">Choose a product…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lb-colour" className="label-caps text-navy-400">
              Colourway
            </Label>
            <select
              id="lb-colour"
              value={colorName}
              disabled={!productId}
              onChange={(e) => setColorName(e.target.value)}
              className="w-full cursor-pointer rounded border border-navy/20 bg-white px-3 py-2 text-[14px] text-navy disabled:cursor-not-allowed disabled:text-navy-300"
            >
              {colours.length === 0 ? (
                <option value="">Choose a product first</option>
              ) : (
                colours.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))
              )}
            </select>
            <p className="text-[11px] tracking-wide text-navy-400">
              Only colourways that have a photograph are listed. The tile uses that photo.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lb-alt" className="label-caps text-navy-400">
              Alt text (optional)
            </Label>
            <Input
              id="lb-alt"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              placeholder="Ruwa Caftan in burgundy satin"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="lb-order" className="label-caps text-navy-400">
              Sort order
            </Label>
            <Input
              id="lb-order"
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
            Shown
          </label>
        </div>

        <div className="flex items-center justify-between pt-2">
          <div>
            {shot && (
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
              {pending ? "Saving…" : shot ? "Save changes" : "Add"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
