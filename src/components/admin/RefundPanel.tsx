"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { refundOrder } from "@/app/admin/actions";
import { Card, CardBody, CardHeader } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRM } from "@/lib/format";

/*
  Refund recording.

  Deliberately explicit that this does NOT move money: LeanX publishes no
  refund API, so the transfer happens in their dashboard. Saying so on the
  control itself is the difference between a clear workflow and someone
  believing a customer has been paid back when they have not.
*/
export function RefundPanel({
  reference,
  totalSen,
  status,
  refundedSen,
  refundedAt,
}: {
  reference: string;
  totalSen: number;
  status: string;
  refundedSen: number;
  refundedAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [amountRm, setAmountRm] = useState((totalSen / 100).toFixed(2));
  const [restock, setRestock] = useState(true);
  const [reason, setReason] = useState("");

  if (status === "refunded") {
    return (
      <Card className="px-5 py-4">
        <p className="label-caps text-navy-400">Refund</p>
        <p className="mt-2 text-[13px] tracking-wide text-navy">
          Refunded {formatRM(refundedSen / 100)}
          {refundedAt ? ` on ${new Date(refundedAt).toLocaleDateString("en-MY", {
            day: "numeric", month: "short", year: "numeric",
          })}` : ""}.
        </p>
      </Card>
    );
  }

  // Only a settled order can be refunded — mirrors the database guard.
  if (!["paid", "fulfilled", "completed"].includes(status)) return null;

  function submit() {
    const amountSen = Math.round(Number(amountRm.replace(/,/g, "")) * 100);
    if (!Number.isFinite(amountSen) || amountSen <= 0) {
      toast.error("Enter a refund amount greater than zero.");
      return;
    }
    startTransition(async () => {
      const res = await refundOrder({ reference, amountSen, restock, reason });
      if ("error" in res) toast.error(res.error);
      else {
        toast.success("Refund recorded.");
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader
        title="Refund"
        action={
          !open ? (
            <Button type="button" variant="kalimaOutline" size="editorial" onClick={() => setOpen(true)}>
              Record refund
            </Button>
          ) : undefined
        }
      />

      <CardBody>
      <p className="text-[13px] tracking-wide text-navy-400">
        <strong className="text-navy">FPX, e-wallet and Atome: move the money first.</strong> LeanX
        and Atome have no refund API here, so for those orders this only records the refund — it
        returns the goods to stock and updates the order. <strong className="text-navy">Card orders
        (Stripe) are refunded for real:</strong> the amount is sent to Stripe before anything is
        recorded, and the customer sees it on their statement in 5–10 days.
      </p>

      {open && (
        <div className="mt-4 space-y-4 border-t border-navy-100 pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="refund-amount">Amount (RM)</Label>
              <Input
                id="refund-amount"
                value={amountRm}
                onChange={(e) => setAmountRm(e.target.value)}
                inputMode="decimal"
                className="mt-1"
              />
              <p className="mt-1 text-[11px] tracking-wide text-navy-400">
                Order total {formatRM(totalSen / 100)}
              </p>
            </div>
            <div>
              <Label htmlFor="refund-reason">Reason</Label>
              <Input
                id="refund-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Customer returned item"
                className="mt-1"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="refund-restock"
              checked={restock}
              onCheckedChange={(v) => setRestock(v === true)}
            />
            <Label htmlFor="refund-restock" className="cursor-pointer text-[13px] font-normal">
              Return the items to stock
            </Label>
          </div>
          <p className="-mt-2 text-[11px] tracking-wide text-navy-400">
            Leave unticked if the goods aren&apos;t coming back (damaged, lost in transit).
            Either way the change is written to the stock ledger.
          </p>

          <div className="flex gap-2">
            <Button type="button" variant="kalima" size="editorial" disabled={pending} onClick={submit}>
              {pending ? "Recording…" : "Record refund"}
            </Button>
            <Button
              type="button"
              variant="kalimaOutline"
              size="editorial"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      </CardBody>
    </Card>
  );
}
