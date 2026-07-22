import type { Metadata } from "next";
import { Card, CardHeader, Chip, StatCard, Table, Td, Tr } from "@/components/admin/ui";
import { listCustomers } from "@/lib/admin";
import { formatRM } from "@/lib/format";

export const metadata: Metadata = {
  title: "Customers · Admin",
  description: "Own your customer data — segment by role, spend and marketing consent.",
};

const dateFmt = new Intl.DateTimeFormat("en-MY", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/* Server Component — real customer data (profiles + LTV) from listCustomers(). */
export default async function AdminCustomersPage() {
  const customers = await listCustomers();
  const totalLtvSen = customers.reduce((n, c) => n + c.ltvSen, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-navy">Customers</h1>
        <p className="mt-1 text-[13px] tracking-wide text-navy-400">
          Own your customer data — segment by role, spend and consent, then reach them via Broadcasts ①.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Total customers" value={customers.length.toLocaleString("en-MY")} />
        <StatCard label="Total lifetime value" value={formatRM(totalLtvSen / 100)} />
      </div>

      <Card>
        <CardHeader title={`${customers.length} ${customers.length === 1 ? "customer" : "customers"}`} />
        {customers.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-navy-400">
            No customers yet. New signups and checkouts will appear here.
          </p>
        ) : (
          <Table head={["Customer", "Email", "Phone", "Role", "Orders", "Lifetime value", "Joined", "Marketing"]}>
            {customers.map((c) => (
              <Tr key={c.id}>
                <Td className="font-medium">{c.name ?? "—"}</Td>
                <Td className="text-navy-400">{c.email || "—"}</Td>
                <Td className="text-navy-400">{c.phone ?? "—"}</Td>
                <Td>
                  <Chip>{c.role}</Chip>
                </Td>
                <Td>{c.orderCount}</Td>
                <Td>{formatRM(c.ltvSen / 100)}</Td>
                <Td className="text-navy-400">{dateFmt.format(new Date(c.createdAt))}</Td>
                <Td>
                  {c.marketingConsent ? (
                    <Chip className="bg-emerald-100 text-emerald-900">WhatsApp OK</Chip>
                  ) : (
                    <span className="text-navy-300">No</span>
                  )}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
