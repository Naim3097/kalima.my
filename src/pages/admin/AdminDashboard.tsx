import { Link } from "react-router-dom";
import { Card, CardHeader, StatCard, Table, Td, Pill, ChannelBadge } from "../../components/admin/ui";
import { ORDERS, SALES_14D, CHANNEL_SPLIT } from "../../data/demo";
import { formatRM } from "../../lib/format";

export default function AdminDashboard() {
  const max = Math.max(...SALES_14D.map((d) => d.total));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl text-navy">Dashboard</h1>
          <p className="mt-1 text-[13px] tracking-wide text-navy-400">Thursday, 17 July 2026</p>
        </div>
        <Link to="/admin/orders" className="label-caps border border-navy/30 px-4 py-2.5 text-navy hover:border-navy transition-colors">
          View Orders
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Sales today" value="RM2,210" sub="▲ 18% vs last Thursday" accent="up" />
        <StatCard label="Orders today" value="9" sub="2 marketplace · 7 web" />
        <StatCard label="Avg order value (30d)" value="RM287" sub="▲ RM12 vs June" accent="up" />
        <StatCard label="Kalima Club signups (7d)" value="86" sub="Conversion 4.1%" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Sales chart */}
        <Card className="xl:col-span-2">
          <CardHeader title="Sales — last 14 days" action={<span className="text-[12px] text-navy-400">{formatRM(SALES_14D.reduce((n, d) => n + d.total, 0))} total</span>} />
          <div className="flex items-end gap-2 px-5 pb-5 pt-6">
            {SALES_14D.map((d) => (
              <div key={d.day} className="group flex flex-1 flex-col items-center gap-2" title={`${d.day}: ${formatRM(d.total)}`}>
                <div
                  className="w-full bg-navy/80 transition-colors group-hover:bg-navy"
                  style={{ height: `${Math.max(6, (d.total / max) * 170)}px` }}
                />
                <span className="hidden text-[9px] tracking-wide text-navy-300 md:block">{d.day.split(" ")[0]}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Channel split */}
        <Card>
          <CardHeader title="Sales by channel — July" />
          <div className="space-y-5 px-5 py-6">
            {CHANNEL_SPLIT.map((c) => (
              <div key={c.channel}>
                <div className="mb-1.5 flex items-center justify-between text-[13px]">
                  <span className="text-navy">{c.channel}</span>
                  <span className="text-navy-400">
                    {formatRM(c.amount)} · {c.pct}%
                  </span>
                </div>
                <div className="h-1.5 w-full bg-navy-100">
                  <div className="h-1.5 bg-navy" style={{ width: `${c.pct}%` }} />
                </div>
              </div>
            ))}
            <p className="pt-2 text-[12px] leading-relaxed tracking-wide text-navy-300">
              Marketplace stock stays in sync automatically — see Marketplace Sync ⑤.
            </p>
          </div>
        </Card>
      </div>

      {/* Recent orders */}
      <Card>
        <CardHeader
          title="Recent orders"
          action={
            <Link to="/admin/orders" className="text-[12px] tracking-wide text-navy-400 hover:text-navy transition-colors">
              View all →
            </Link>
          }
        />
        <Table head={["Order", "Customer", "Channel", "Items", "Total", "Status"]}>
          {ORDERS.slice(0, 5).map((o) => (
            <tr key={o.id} className="hover:bg-cream-50">
              <Td className="font-medium">{o.id}</Td>
              <Td>{o.customer}</Td>
              <Td>
                <ChannelBadge channel={o.channel} />
              </Td>
              <Td className="max-w-56 truncate">{o.items}</Td>
              <Td>{formatRM(o.total)}</Td>
              <Td>
                <Pill value={o.status} />
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
