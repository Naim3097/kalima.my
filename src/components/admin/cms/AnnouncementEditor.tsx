"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveAnnouncement, deleteAnnouncement } from "@/app/admin/actions";
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
import type { AdminAnnouncement } from "@/lib/admin";

type Props = {
  /** Existing announcement to edit; omit for a new message. */
  announcement?: AdminAnnouncement;
};

/*
  Create/edit dialog for a storefront announcement-bar message. Renders its own
  trigger — a subtle "Edit" for existing rows, a primary "New message" when
  creating. saveAnnouncement / deleteAnnouncement revalidate /admin/cms and the
  storefront on success.
*/
export function AnnouncementEditor({ announcement }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [text, setText] = useState(announcement?.text ?? "");
  const [sortOrder, setSortOrder] = useState(String(announcement?.sortOrder ?? 0));
  const [active, setActive] = useState(announcement?.active ?? true);

  function reset() {
    setText(announcement?.text ?? "");
    setSortOrder(String(announcement?.sortOrder ?? 0));
    setActive(announcement?.active ?? true);
  }

  function submit() {
    if (!text.trim()) {
      toast.error("Message text is required.");
      return;
    }
    startTransition(async () => {
      const res = await saveAnnouncement({
        id: announcement?.id,
        text: text.trim(),
        sortOrder: Math.round(Number(sortOrder) || 0),
        active,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(announcement ? "Announcement updated." : "Announcement created.");
      setOpen(false);
      if (!announcement) {
        setText("");
        setSortOrder("0");
        setActive(true);
      }
    });
  }

  function remove() {
    if (!announcement) return;
    startTransition(async () => {
      const res = await deleteAnnouncement(announcement.id);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Announcement deleted.");
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
        {announcement ? (
          <Button variant="kalimaOutline" size="sm" className="cursor-pointer">
            Edit
          </Button>
        ) : (
          <Button variant="kalima" size="editorial" className="cursor-pointer px-4 py-2.5">
            New message
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="border-navy/10">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-navy">
            {announcement ? "Edit announcement" : "New announcement"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ann-text" className="label-caps text-navy-400">
              Message
            </Label>
            <Input
              id="ann-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Free shipping on orders over RM150"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ann-order" className="label-caps text-navy-400">
              Sort order
            </Label>
            <Input
              id="ann-order"
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
            {announcement && (
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
              {pending ? "Saving…" : announcement ? "Save changes" : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
