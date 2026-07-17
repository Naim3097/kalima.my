import { Card, CardHeader, Table, Td, DemoNote } from "../../components/admin/ui";
import { CUSTOMERS } from "../../data/demo";
import { formatRM } from "../../lib/format";

export default function AdminCustomers() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-navy">Customers</h1>
        <p className="mt-1 text-[13px] tracking-wide text-navy-400">
          Own your customer data — segment by tags, spend and tier, then reach them via Broadcasts ①.
        </p>
      </div>

      <Card>
        <CardHeader title={`${CUSTOMERS.length} customers (sample)`} />
        <Table head={["Customer", "Phone (WhatsApp)", "Tags", "Orders", "Lifetime value", "Club points", "Tier", "Marketing consent"]}>
          {CUSTOMERS.map((c) => (
            <tr key={c.name} className="hover:bg-cream-50">
              <Td className="font-medium">{c.name}</Td>
              <Td className="text-navy-400">{c.phone}</Td>
              <Td>
                <div className="flex gap-1.5">
                  {c.tags.map((t) => (
                    <span key={t} className="rounded bg-navy-100 px-2 py-0.5 text-[10px] uppercase tracking-wider text-navy">
                      {t}
                    </span>
                  ))}
                </div>
              </Td>
              <Td>{c.orders}</Td>
              <Td>{formatRM(c.ltv)}</Td>
              <Td>{c.points.toLocaleString()}</Td>
              <Td>
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider ${
                    c.tier === "Platinum"
                      ? "bg-navy text-white"
                      : c.tier === "Gold"
                        ? "bg-amber-100 text-amber-900"
                        : "bg-navy-100 text-navy"
                  }`}
                >
                  {c.tier}
                </span>
              </Td>
              <Td>{c.consent ? "✓ Yes" : <span className="text-navy-300">No</span>}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      <DemoNote>
        Demo data. PDPA consent is captured at signup/checkout and enforced automatically — customers without
        consent are excluded from every broadcast audience.
      </DemoNote>
    </div>
  );
}
