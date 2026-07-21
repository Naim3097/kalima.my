import type { Metadata } from "next";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Card, CardHeader, ChannelBadge, Pill, StatCard, Table, Td, Tr } from "@/components/admin/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { CHANNEL_SPLIT, ORDERS } from "@/data/demo";
import { formatRM } from "@/lib/format";

/*
  Server Component — every figure comes from the static demo dataset, so the
  whole page is static HTML. The 14-day bar chart is below the fold and gets
  code-split out of the initial payload.
*/
const SalesChart = dynamic(() => import("@/components/admin/SalesChart"), {
  loading: () => <Skeleton className="h-[300px] xl:col-span-2" />,
});

export const metadata: Metadata = {
  title: "Dashboard · Admin",
  description: "Kalima back-office dashboard — sales, orders and channel performance.",
};

export default function AdminDashboardPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl text-navy">Dashboard</h1>
          <p className="mt-1 text-[13px] tracking-wide text-navy-400">Thursday, 17 July 2026</p>
        </div>
        <Link href="/admin/orders" className="label-caps border border-navy/30 px-4 py-2.5 text-navy hover:border-navy transition-colors">
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
        <SalesChart />

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
            <Link href="/admin/orders" className="text-[12px] tracking-wide text-navy-400 hover:text-navy transition-colors">
              View all →
            </Link>
          }
        />
        <Table head={["Order", "Customer", "Channel", "Items", "Total", "Status"]}>
          {ORDERS.slice(0, 5).map((o) => (
            <Tr key={o.id}>
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
            </Tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
