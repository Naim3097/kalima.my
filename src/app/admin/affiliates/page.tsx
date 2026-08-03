import type { Metadata } from "next";
import { AffiliateControls } from "@/components/admin/AffiliateControls";
import { Card, CardBody, CardHeader, Chip } from "@/components/admin/ui";
import { listAffiliates } from "@/lib/affiliate";
import { formatRM } from "@/lib/format";

export const metadata: Metadata = {
  title: "Affiliates · Admin",
  description: "Affiliate approvals, commission rates and payouts.",
};

/*
  Replaces the Phase 3 demo mock-up.

  Balances are derived from the referral ledger, never stored on the affiliate
  row — a running total that can drift from the rows it summarises is how people
  get paid twice.
*/
export default async function AdminAffiliatesPage() {
  const affiliates = await listAffiliates();
  const pendingCount = affiliates.filter((a) => a.status === "pending").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-navy">Affiliates</h1>
        <p className="mt-1 text-[13px] tracking-wide text-navy-400">
          Commission accrues only on paid orders, is held for 14 days against returns,
          and is reversed automatically if the order is refunded.
        </p>
      </div>

      {pendingCount > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-[13px] tracking-wide text-amber-900">
            {pendingCount} application{pendingCount === 1 ? "" : "s"} waiting for review.
            A pending affiliate earns nothing until approved.
          </p>
        </div>
      )}

      {affiliates.length === 0 ? (
        <Card>
          <CardHeader title="No affiliates yet" />
          <CardBody>
            <p className="text-[13px] tracking-wide text-navy-400">
              People apply at <code>/affiliate</code>. Approve them here and they get a
              referral link and, optionally, a discount code.
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-4">
          {affiliates.map((a) => (
            <Card key={a.id}>
              <CardHeader title={a.name} action={<Chip>{a.status}</Chip>} />
              <div className="px-5 pt-4 flex flex-wrap gap-x-6 gap-y-1 text-[12px] tracking-wide text-navy-400">
                <span>{a.email}</span>
                <span>?ref={a.slug}</span>
                <span>{a.stats.clicks} clicks</span>
                <span>{a.stats.orders} orders</span>
              </div>

              <div className="mb-4 grid gap-3 sm:grid-cols-4">
                {([
                  ["Held", a.stats.pendingSen, "in return window"],
                  ["Payable", a.stats.payableSen, "cleared"],
                  ["Paid", a.stats.paidSen, "to date"],
                  ["Reversed", a.stats.clawedBackSen, "refunded orders"],
                ] as [string, number, string][]).map(([label, sen, hint]) => (
                  <div key={label} className="rounded border border-navy-100 px-3 py-2">
                    <p className="label-caps text-[10px] text-navy-400">{label}</p>
                    <p className="mt-0.5 text-[15px] tabular-nums text-navy">
                      {formatRM(sen / 100)}
                    </p>
                    <p className="text-[10px] tracking-wide text-navy-300">{hint}</p>
                  </div>
                ))}
              </div>

              <AffiliateControls affiliate={a} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
