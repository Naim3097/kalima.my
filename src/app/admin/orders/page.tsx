import type { Metadata } from "next";
import Link from "next/link";
import OrdersBrowser from "@/components/admin/OrdersBrowser";
import { Card, CardHeader, Pill, Table, Td, Tr } from "@/components/admin/ui";
import { listOrders, type OrderStatus } from "@/lib/admin";
import { formatRM } from "@/lib/format";

export const metadata: Metadata = {
  title: "Orders · Admin",
  description: "Web and marketplace orders in a single Kalima back-office list.",
};

const dateFmt = new Intl.DateTimeFormat("en-MY", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/*
  Server Component. Filters live in the URL (?status=&q=) so the list re-queries
  on the server; the OrdersBrowser island above only rewrites those params.
*/
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status, q } = await searchParams;
  const orders = await listOrders({ status: status as OrderStatus | undefined, q });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-navy">Orders</h1>
        <p className="mt-1 text-[13px] tracking-wide text-navy-400">
          Web + marketplace orders in one list. Filter by status or search a reference or customer email.
        </p>
      </div>

      <OrdersBrowser status={status as OrderStatus | undefined} q={q} />

      <Card>
        <CardHeader title={`${orders.length} ${orders.length === 1 ? "order" : "orders"}`} />
        {orders.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-navy-400">
            No orders match these filters.
          </p>
        ) : (
          <Table head={["Order", "Customer", "Date", "Items", "Total", "Status"]}>
            {orders.map((o) => (
              <Tr key={o.reference}>
                <Td className="font-medium">
                  <Link href={`/admin/orders/${o.reference}`} className="text-navy hover:underline">
                    {o.reference}
                  </Link>
                </Td>
                <Td>{o.customerName ?? o.email}</Td>
                <Td className="text-navy-400">{dateFmt.format(new Date(o.createdAt))}</Td>
                <Td className="text-navy-400">{o.itemCount}</Td>
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
