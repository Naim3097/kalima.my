import type { Metadata } from "next";
import { Card, CardBody, CardHeader, Table, Td, Tr } from "@/components/admin/ui";
import { getLoyaltyLiability, getLoyaltyRules, getTiers } from "@/lib/loyalty";
import { formatRM } from "@/lib/format";

export const metadata: Metadata = {
  title: "Kalima Club · Admin",
  description: "Loyalty rules, tiers and outstanding points liability.",
};

/*
  Replaces the Phase 3 demo mock-up.

  The headline number is the LIABILITY — outstanding points are money the shop
  has promised and will have to honour, so it belongs on the same screen as the
  rules that create it.
*/
export default async function AdminLoyaltyPage() {
  const [liability, rules, tiers] = await Promise.all([
    getLoyaltyLiability(),
    getLoyaltyRules(),
    getTiers(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-navy">Kalima Club</h1>
        <p className="mt-1 text-[13px] tracking-wide text-navy-400">
          Points are earned when an order completes — after the return window — and are
          reversed automatically if it is refunded.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="px-5 py-4">
          <p className="label-caps text-[10px] text-navy-400">Outstanding liability</p>
          <p className="mt-1 font-display text-3xl text-navy">
            {formatRM(liability.valueSen / 100)}
          </p>
          <p className="text-[11px] tracking-wide text-navy-400">
            what unredeemed points are worth
          </p>
        </Card>
        <Card className="px-5 py-4">
          <p className="label-caps text-[10px] text-navy-400">Points outstanding</p>
          <p className="mt-1 font-display text-3xl text-navy">{liability.outstandingPoints}</p>
        </Card>
        <Card className="px-5 py-4">
          <p className="label-caps text-[10px] text-navy-400">Members with a balance</p>
          <p className="mt-1 font-display text-3xl text-navy">{liability.members}</p>
        </Card>
      </div>

      <Card>
        <CardHeader title="Earn and redemption rules" />
        <CardBody>
        <dl className="grid gap-4 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Earn rate", `${rules.pointsPerRm} point per RM1 spent`],
            ["Point value", `${formatRM(rules.senPerPoint / 100)} per point`],
            ["100 points", `= ${formatRM((100 * rules.senPerPoint) / 100)}`],
            ["Minimum redemption", `${rules.minRedeemPoints} points`],
            ["Max per order", `${rules.maxRedeemBps / 100}% of the order`],
            ["Points expire after", `${rules.expiryMonths} months`],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="label-caps text-[10px] text-navy-400">{label}</dt>
              <dd className="mt-0.5 text-navy">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-[12px] tracking-wide text-navy-400">
          Points earn on goods after discount — shipping and tax are excluded, since
          those are passed through rather than earned on.
        </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`${tiers.length} tiers`} />
        <Table head={["Tier", "Qualifying 12-month spend", "Points multiplier", "Perks"]}>
          {tiers.map((t) => (
            <Tr key={t.name}>
              <Td className="font-medium">{t.name}</Td>
              <Td className="text-navy-400">
                {t.minSpendSen === 0 ? "On joining" : formatRM(t.minSpendSen / 100)}
              </Td>
              <Td>{(t.multiplierBps / 10000).toFixed(t.multiplierBps % 10000 ? 1 : 0)}×</Td>
              <Td className="text-navy-400">{t.freeShipping ? "Free shipping" : "—"}</Td>
            </Tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
