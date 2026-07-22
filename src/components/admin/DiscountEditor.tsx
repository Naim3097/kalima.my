"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveDiscount, toggleDiscount } from "@/app/admin/actions";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DiscountRow } from "@/lib/admin";

type Kind = "percent" | "fixed" | "free_shipping";

type EditorProps = {
  /** Existing discount to edit; omit for a new code. */
  discount?: DiscountRow;
  /** Trigger button label + style differs for "New code" vs "Edit". */
  trigger: "new" | "edit";
};

/*
  Create/edit dialog for a discount code. Collects human units (percent, or
  RM for fixed amounts / min spend) and converts to the units saveDiscount
  expects before calling: percent stays 1-100, fixed becomes sen, min spend
  becomes sen. The action revalidates /admin/discounts on success.
*/
export function DiscountEditor({ discount, trigger }: EditorProps) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [code, setCode] = useState(discount?.code ?? "");
  const [kind, setKind] = useState<Kind>((discount?.kind as Kind) ?? "percent");
  // amount is shown in human units: % for percent, RM for fixed.
  const [amount, setAmount] = useState(
    discount ? (discount.kind === "fixed" ? String(discount.amount / 100) : String(discount.amount)) : "",
  );
  const [minSpend, setMinSpend] = useState(
    discount && discount.minSpendSen ? String(discount.minSpendSen / 100) : "",
  );
  const [maxRedemptions, setMaxRedemptions] = useState(
    discount?.maxRedemptions != null ? String(discount.maxRedemptions) : "",
  );
  const [active, setActive] = useState(discount?.active ?? true);

  function submit() {
    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedCode) {
      toast.error("Code is required.");
      return;
    }

    const ringgit = Number(amount);
    let outAmount = 0;
    if (kind === "percent") outAmount = Math.round(ringgit);
    else if (kind === "fixed") outAmount = Math.round(ringgit * 100);

    const minSpendSen = minSpend.trim() ? Math.round(Number(minSpend) * 100) : 0;
    const maxRed = maxRedemptions.trim() ? Math.round(Number(maxRedemptions)) : null;

    startTransition(async () => {
      const res = await saveDiscount({
        id: discount?.id,
        code: trimmedCode,
        kind,
        amount: outAmount,
        minSpendSen,
        maxRedemptions: maxRed,
        active,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(discount ? "Discount updated." : "Discount created.");
      setOpen(false);
      if (!discount) {
        // reset the form for the next new code
        setCode("");
        setKind("percent");
        setAmount("");
        setMinSpend("");
        setMaxRedemptions("");
        setActive(true);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger === "new" ? (
          <Button variant="kalima" size="editorial" className="cursor-pointer px-4 py-2.5">
            New code
          </Button>
        ) : (
          <Button variant="kalimaOutline" size="sm" className="cursor-pointer">
            Edit
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="border-navy/10">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-navy">
            {discount ? `Edit ${discount.code}` : "New discount code"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="disc-code" className="label-caps text-navy-400">
              Code
            </Label>
            <Input
              id="disc-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="AISYAH10"
              className="uppercase"
            />
          </div>

          <div className="space-y-2">
            <Label className="label-caps text-navy-400">Type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">Percentage off</SelectItem>
                <SelectItem value="fixed">Fixed amount off</SelectItem>
                <SelectItem value="free_shipping">Free shipping</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {kind !== "free_shipping" && (
            <div className="space-y-2">
              <Label htmlFor="disc-amount" className="label-caps text-navy-400">
                {kind === "percent" ? "Percentage (1–100)" : "Amount off (RM)"}
              </Label>
              <Input
                id="disc-amount"
                type="number"
                min={kind === "percent" ? 1 : 0}
                max={kind === "percent" ? 100 : undefined}
                step={kind === "percent" ? 1 : "0.01"}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={kind === "percent" ? "10" : "10.00"}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="disc-min" className="label-caps text-navy-400">
                Min spend (RM)
              </Label>
              <Input
                id="disc-min"
                type="number"
                min={0}
                step="0.01"
                value={minSpend}
                onChange={(e) => setMinSpend(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="disc-max" className="label-caps text-navy-400">
                Max redemptions
              </Label>
              <Input
                id="disc-max"
                type="number"
                min={0}
                step={1}
                value={maxRedemptions}
                onChange={(e) => setMaxRedemptions(e.target.value)}
                placeholder="Unlimited"
              />
            </div>
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
            {pending ? "Saving…" : discount ? "Save changes" : "Create code"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/*
  Inline active/inactive toggle rendered in the table. Flips the current state
  through toggleDiscount and surfaces any error.
*/
export function DiscountToggle({ id, active }: { id: string; active: boolean }) {
  const [pending, startTransition] = useTransition();

  function flip() {
    startTransition(async () => {
      const res = await toggleDiscount(id, !active);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(active ? "Code deactivated." : "Code activated.");
    });
  }

  return (
    <button
      type="button"
      onClick={flip}
      disabled={pending}
      className={`label-caps rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50 ${
        active
          ? "bg-emerald-100 text-emerald-900 hover:bg-emerald-200"
          : "bg-navy-100 text-navy-400 hover:text-navy"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </button>
  );
}
