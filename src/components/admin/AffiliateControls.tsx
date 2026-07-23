"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { recordAffiliatePayout, updateAffiliate } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatRM } from "@/lib/format";
import type { AffiliateWithStats } from "@/lib/affiliate";

const STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "suspended", label: "Suspended" },
];

/*
  Per-affiliate controls: approve, set the rate, attach a discount code, and
  record a payout.

  Payout deliberately has no amount field — the server settles exactly the
  referrals that are past their hold period and derives the total from them.
  A typed amount could disagree with the ledger, and the ledger has to win.
*/
export function AffiliateControls({ affiliate }: { affiliate: AffiliateWithStats }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rate, setRate] = useState((affiliate.commissionBps / 100).toString());
  const [code, setCode] = useState(affiliate.discountCode ?? "");
  const [payRef, setPayRef] = useState("");
  const [showPay, setShowPay] = useState(false);

  function save(patch: Parameters<typeof updateAffiliate>[0]) {
    startTransition(async () => {
      const res = await updateAffiliate(patch);
      if ("error" in res) toast.error(res.error);
      else { toast.success("Saved."); router.refresh(); }
    });
  }

  function pay() {
    startTransition(async () => {
      const res = await recordAffiliatePayout({
        affiliateId: affiliate.id, reference: payRef, note: "",
      });
      if ("error" in res) toast.error(res.error);
      else {
        toast.success(`Paid ${formatRM((res.amountSen ?? 0) / 100)} across ${res.count} referral(s).`);
        setShowPay(false);
        setPayRef("");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label-caps text-[10px] text-navy-400">Status</label>
          <Select
            value={affiliate.status}
            onValueChange={(v) => save({ id: affiliate.id, status: v })}
          >
            <SelectTrigger className="mt-1 h-8 w-36 text-[12px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="label-caps text-[10px] text-navy-400">Commission %</label>
          <Input
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            onBlur={() => {
              const bps = Math.round(Number(rate) * 100);
              if (Number.isFinite(bps) && bps !== affiliate.commissionBps) {
                save({ id: affiliate.id, commissionBps: bps });
              }
            }}
            inputMode="decimal"
            className="mt-1 h-8 w-24 text-[12px]"
          />
        </div>

        <div>
          <label className="label-caps text-[10px] text-navy-400">Discount code</label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onBlur={() => {
              if (code.trim().toUpperCase() !== (affiliate.discountCode ?? "")) {
                save({ id: affiliate.id, discountCode: code });
              }
            }}
            placeholder="none"
            className="mt-1 h-8 w-40 text-[12px]"
          />
        </div>

        {affiliate.stats.payableSen > 0 && !showPay && (
          <Button type="button" variant="kalima" size="editorial"
            disabled={pending} onClick={() => setShowPay(true)}>
            Pay {formatRM(affiliate.stats.payableSen / 100)}
          </Button>
        )}
      </div>

      {showPay && (
        <div className="flex flex-wrap items-end gap-3 rounded border border-navy-100 p-3">
          <div>
            <label className="label-caps text-[10px] text-navy-400">Transfer reference</label>
            <Input
              value={payRef}
              onChange={(e) => setPayRef(e.target.value)}
              placeholder="DuitNow ref"
              className="mt-1 h-8 w-48 text-[12px]"
            />
          </div>
          <Button type="button" variant="kalima" size="editorial" disabled={pending} onClick={pay}>
            {pending ? "Recording…" : `Confirm ${formatRM(affiliate.stats.payableSen / 100)} paid`}
          </Button>
          <Button type="button" variant="kalimaOutline" size="editorial"
            disabled={pending} onClick={() => setShowPay(false)}>
            Cancel
          </Button>
          <p className="w-full text-[11px] tracking-wide text-navy-400">
            Transfer the money first. This records it and settles only the referrals
            past their hold period.
          </p>
        </div>
      )}
    </div>
  );
}
