"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { archiveProduct, deleteProduct, restoreProduct } from "@/app/admin/actions";
import { Pill } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Props = {
  productId: string;
  productName: string;
  /** Order lines referencing this product. Non-zero → archive instead of delete. */
  orderLineCount: number;
  archived: boolean;
};

/*
  The product editor's way out.

  A product that has never sold can be deleted outright. One that has sold
  cannot (order_items restricts its variants — refunds need them to return
  stock), so the same button offers Archive instead: hidden from the admin
  list and the shop, every row kept. The page already knows the order count,
  so the dialog opens in the right mode rather than failing first. The server
  re-checks either way.
*/
export function DeleteProduct({ productId, productName, orderLineCount, archived }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const sold = orderLineCount > 0;

  function run(
    action: (id: string) => Promise<{ ok: true } | { error: string }>,
    done: string,
    then: "list" | "refresh",
  ) {
    startTransition(async () => {
      const res = await action(productId);
      if ("error" in res) {
        toast.error(res.error);
        setOpen(false);
        return;
      }
      toast.success(done);
      setOpen(false);
      if (then === "list") router.push("/admin/products");
      else router.refresh();
    });
  }

  const restore = archived && (
    <Button
      variant="kalimaOutline"
      size="sm"
      className="cursor-pointer"
      disabled={pending}
      onClick={() => run(restoreProduct, `"${productName}" restored as a draft.`, "refresh")}
    >
      {pending ? "Restoring…" : "Restore"}
    </Button>
  );

  // Archived and sold: nothing left to do but bring it back.
  if (archived && sold) {
    return (
      <div className="flex items-center gap-3">
        <Pill value="archived" />
        {restore}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {archived && <Pill value="archived" />}
      {restore}
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogTrigger asChild>
          <Button
            variant="kalimaOutline"
            size="sm"
            className="cursor-pointer border-red-300 text-red-700 hover:border-red-600"
          >
            {sold ? "Archive product" : "Delete product"}
          </Button>
        </DialogTrigger>
        <DialogContent className="border-navy/10 bg-white">
          <DialogHeader>
            <DialogTitle className="text-navy">
              {sold ? `Archive “${productName}”?` : `Delete “${productName}”?`}
            </DialogTitle>
            <DialogDescription className="text-[13px] tracking-wide text-navy-400">
              {sold
                ? `It appears in ${orderLineCount} order line${orderLineCount === 1 ? "" : "s"}, so it can't be deleted — refunds and order history still need it. Archiving unpublishes it and hides it from the Products list. You can restore it any time from "Show archived".`
                : "This permanently removes the product with its variants, stock history, images, size chart and add-on links. It can't be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="kalimaOutline"
              size="sm"
              className="cursor-pointer"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            {sold ? (
              <Button
                variant="kalima"
                size="sm"
                className="cursor-pointer"
                onClick={() => run(archiveProduct, `"${productName}" archived.`, "list")}
                disabled={pending}
              >
                {pending ? "Archiving…" : "Archive"}
              </Button>
            ) : (
              <Button
                variant="kalima"
                size="sm"
                className="cursor-pointer bg-red-700 hover:bg-red-800"
                onClick={() => run(deleteProduct, `"${productName}" deleted.`, "list")}
                disabled={pending}
              >
                {pending ? "Deleting…" : "Delete permanently"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
