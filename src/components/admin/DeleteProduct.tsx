"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deleteProduct } from "@/app/admin/actions";
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

/*
  Permanent delete for a product that was never sold. The server refuses if any
  variant is on an order and says to unpublish instead, so this dialog only has
  to make the irreversibility clear.
*/
export function DeleteProduct({ productId, productName }: { productId: string; productName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const res = await deleteProduct(productId);
      if ("error" in res) {
        toast.error(res.error);
        setOpen(false);
        return;
      }
      toast.success(`"${productName}" deleted.`);
      router.push("/admin/products");
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <DialogTrigger asChild>
        <Button variant="kalimaOutline" size="sm" className="cursor-pointer border-red-300 text-red-700 hover:border-red-600">
          Delete product
        </Button>
      </DialogTrigger>
      <DialogContent className="border-navy/10 bg-white">
        <DialogHeader>
          <DialogTitle className="text-navy">Delete “{productName}”?</DialogTitle>
          <DialogDescription className="text-[13px] tracking-wide text-navy-400">
            This permanently removes the product with its variants, stock history, images,
            size chart and add-on links. It can&apos;t be undone. Products that have been
            ordered can&apos;t be deleted — unpublish those instead.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="kalimaOutline" size="sm" className="cursor-pointer" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" className="cursor-pointer" onClick={remove} disabled={pending}>
            {pending ? "Deleting…" : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
