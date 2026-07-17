import { Card, CardHeader, StatCard, Table, Td, Pill, DemoNote } from "../../components/admin/ui";
import { AFFILIATES } from "../../data/demo";
import { formatRM } from "../../lib/format";

export default function AdminAffiliates() {
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl text-navy">Affiliates ②</h1>
          <p className="mt-1 text-[13px] tracking-wide text-navy-400">
            Unique codes + trackable links for every ambassador. Commission accrues only on paid orders, with
            clawback on refunds.
          </p>
        </div>
        <button className="label-caps bg-navy px-5 py-2.5 text-white hover:bg-navy-700 transition-colors cursor-pointer">
          + Invite Affiliate
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Active affiliates" value="3" sub="1 application pending" />
        <StatCard label="Affiliate sales (30d)" value="RM109,820" sub="23% of total revenue" />
        <StatCard label="Commission owed" value="RM10,982" sub="At default 10% rate" />
        <StatCard label="Avg conversion" value="4.9%" sub="Clicks → paid orders" accent="up" />
      </div>

      <Card>
        <CardHeader
          title="Affiliate partners"
          action={<span className="text-[12px] text-navy-400">Attribution: code at checkout, or ?ref= link (30-day cookie)</span>}
        />
        <Table head={["Affiliate", "Code", "Link", "Clicks", "Orders", "Sales", "Commission (10%)", "Status", ""]}>
          {AFFILIATES.map((a) => (
            <tr key={a.code} className="hover:bg-cream-50">
              <Td className="font-medium">{a.name}</Td>
              <Td>
                <code className="rounded bg-navy-100 px-2 py-1 text-[12px] text-navy">{a.code}</code>
              </Td>
              <Td className="text-navy-400">kalima.my/?ref={a.code.toLowerCase()}</Td>
              <Td>{a.clicks.toLocaleString()}</Td>
              <Td>{a.orders}</Td>
              <Td>{formatRM(a.sales)}</Td>
              <Td className="font-medium">{formatRM(a.commission)}</Td>
              <Td>
                <Pill value={a.status} />
              </Td>
              <Td>
                {a.status === "active" ? (
                  <button className="label-caps border border-navy/30 px-3 py-1.5 text-navy hover:border-navy transition-colors cursor-pointer">
                    Mark payout
                  </button>
                ) : (
                  <button className="label-caps bg-navy px-3 py-1.5 text-white hover:bg-navy-700 transition-colors cursor-pointer">
                    Approve
                  </button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <DemoNote>
        Demo preview of Phase 6. Affiliates get their own portal (see /affiliate on the storefront) with live stats
        and marketing assets. Fraud guards: self-purchase block, 14-day commission hold matching the return window,
        one attribution per order.
      </DemoNote>
    </div>
  );
}
