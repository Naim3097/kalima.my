import { Card, CardHeader, StatCard, Table, Td, DemoNote } from "../../components/admin/ui";
import { TIERS, CUSTOMERS } from "../../data/demo";

export default function AdminLoyalty() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-navy">Kalima Club ③</h1>
        <p className="mt-1 text-[13px] tracking-wide text-navy-400">
          Loyalty & membership — points on every ringgit, tiers with real perks, birthday rewards on autopilot.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Club members" value="5,517" sub="▲ 86 this week" accent="up" />
        <StatCard label="Points issued (30d)" value="41,205" sub="≈ RM2,060 value" />
        <StatCard label="Points redeemed (30d)" value="18,930" sub="46% redemption rate" />
        <StatCard label="Repeat purchase rate" value="38%" sub="Members vs 19% non-members" accent="up" />
      </div>

      {/* Tiers */}
      <div className="grid gap-4 md:grid-cols-3">
        {TIERS.map((t) => (
          <Card key={t.name} className={t.name === "Platinum" ? "border-navy" : ""}>
            <div className="border-b border-navy/10 px-5 py-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-2xl text-navy">{t.name}</h3>
                <span className="text-[12px] tracking-wide text-navy-400">{t.members.toLocaleString()} members</span>
              </div>
              <p className="mt-1 text-[12px] tracking-wide text-navy-400">
                {t.threshold} · {t.multiplier}
              </p>
            </div>
            <ul className="space-y-2 px-5 py-4">
              {t.perks.map((perk) => (
                <li key={perk} className="flex gap-2 text-[13px] text-navy">
                  <span className="text-navy-300">✓</span> {perk}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Earn & redeem rules" />
          <div className="divide-y divide-navy/5 px-5 text-[13px]">
            {[
              ["Earn rate", "RM1 spent = 1 point (credited after 14-day return window)"],
              ["Redemption", "100 points = RM5 off · min 200 points · max 50% of order"],
              ["Expiry", "Points expire 12 months after earning"],
              ["Birthday", "Auto voucher via WhatsApp/email on member's birthday month"],
              ["Tier review", "12-month rolling spend, evaluated monthly"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-6 py-3.5">
                <span className="label-caps shrink-0 pt-0.5 text-navy-400">{k}</span>
                <span className="text-right text-navy">{v}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Top members" />
          <Table head={["Member", "Tier", "Points balance", "Lifetime spend"]}>
            {CUSTOMERS.filter((c) => c.points > 0)
              .sort((a, b) => b.points - a.points)
              .map((c) => (
                <tr key={c.name} className="hover:bg-cream-50">
                  <Td className="font-medium">{c.name}</Td>
                  <Td>{c.tier}</Td>
                  <Td>{c.points.toLocaleString()}</Td>
                  <Td>RM{c.ltv.toLocaleString()}</Td>
                </tr>
              ))}
          </Table>
        </Card>
      </div>

      <DemoNote>
        Demo preview of Phase 7. Points live in an auditable ledger (earn/redeem/expire entries) with an
        outstanding-liability report for accounting. Members see their balance, tier progress and history in their
        account — see the storefront /account mockup.
      </DemoNote>
    </div>
  );
}
