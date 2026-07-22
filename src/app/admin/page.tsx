import type { Metadata } from "next";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Card, CardHeader, Pill, StatCard, Table, Td, Tr } from "@/components/admin/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { getDashboardStats } from "@/lib/admin";
import { formatRM } from "@/lib/format";

/*
  Server Component — every figure comes from getDashboardStats() (live orders).
  The 14-day bar chart sits below the fold, so it's code-split out of the
  initial payload via next/dynamic.
*/
const SalesChart = dynamic(() => import("@/components/admin/SalesChart"), {
  loading: () => <Skeleton className="h-[300px] xl:col-span-2" />,
});

export const metadata: Metadata = {
  title: "Dashboard · Admin",
  description: "Kalima back-office dashboard — sales, orders and top products.",
};

export default async function AdminDashboardPage() {
  const stats = await getDashboardStats();
  const today = new Intl.DateTimeFormat("en-MY", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
  const topMax = Math.max(1, ...stats.topProducts.map((p) => p.qty));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl text-navy">Dashboard</h1>
          <p className="mt-1 text-[13px] tracking-wide text-navy-400">{today}</p>
        </div>
        <Link href="/admin/orders" className="label-caps border border-navy/30 px-4 py-2.5 text-navy hover:border-navy transition-colors">
          View Orders
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Sales today" value={formatRM(stats.salesTodaySen / 100)} />
        <StatCard label="Orders today" value={String(stats.ordersToday)} />
        <StatCard label="Avg order value (30d)" value={formatRM(stats.aov30dSen / 100)} />
        <StatCard
          label="Pending orders"
          value={String(stats.pendingOrders)}
          sub={stats.pendingOrders > 0 ? "Awaiting payment — see Orders" : "All caught up"}
          accent={stats.pendingOrders > 0 ? "down" : undefined}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Sales chart */}
        <SalesChart data={stats.sales14d} />

        {/* Top products (30 days) */}
        <Card>
          <CardHeader
            title="Top products — 30 days"
            action={<span className="text-[12px] text-navy-400">by units</span>}
          />
          <div className="space-y-4 px-5 py-6">
            {stats.topProducts.length === 0 ? (
              <p className="text-[13px] tracking-wide text-navy-400">No sales in the last 30 days yet.</p>
            ) : (
              stats.topProducts.map((p) => (
                <div key={p.name}>
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-[13px]">
                    <span className="truncate text-navy">{p.name}</span>
                    <span className="whitespace-nowrap text-navy-400">
                      {p.qty} units · {formatRM(p.revenueSen / 100)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-navy-100">
                    <div className="h-1.5 bg-navy" style={{ width: `${(p.qty / topMax) * 100}%` }} />
                  </div>
                </div>
              ))
            )}
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
        {stats.recent.length === 0 ? (
          <p className="px-5 py-6 text-[13px] tracking-wide text-navy-400">No orders yet.</p>
        ) : (
          <Table head={["Order", "Customer", "Items", "Total", "Status"]}>
            {stats.recent.map((o) => (
              <Tr key={o.reference}>
                <Td className="font-medium">
                  <Link href={`/admin/orders/${o.reference}`} className="hover:underline">
                    {o.reference}
                  </Link>
                </Td>
                <Td>{o.customerName ?? o.email}</Td>
                <Td>{o.itemCount} items</Td>
                <Td>{formatRM(o.totalSen / 100)}</Td>
                <Td>
                  <Pill value={o.status} />
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
