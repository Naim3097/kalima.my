import type { Metadata } from "next";
import { DiscountEditor, DiscountToggle } from "@/components/admin/DiscountEditor";
import { Card, CardHeader, Table, Td, Tr } from "@/components/admin/ui";
import { listDiscounts, type DiscountRow } from "@/lib/admin";
import { formatRM } from "@/lib/format";

export const metadata: Metadata = {
  title: "Discounts · Admin",
  description: "Create and manage discount codes — percentage, fixed and free-shipping offers.",
};

function describeKind(d: DiscountRow): string {
  if (d.kind === "percent") return `${d.amount}% off`;
  if (d.kind === "fixed") return `${formatRM(d.amount / 100)} off`;
  if (d.kind === "free_shipping") return "Free shipping";
  return d.kind;
}

/* Server Component — real discount codes from listDiscounts(). */
export default async function AdminDiscountsPage() {
  const discounts = await listDiscounts();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-navy">Discounts</h1>
          <p className="mt-1 text-[13px] tracking-wide text-navy-400">
            Percentage, fixed-amount and free-shipping codes. Toggle a code to switch it on or off instantly.
          </p>
        </div>
        <DiscountEditor trigger="new" />
      </div>

      <Card>
        <CardHeader title={`${discounts.length} ${discounts.length === 1 ? "code" : "codes"}`} />
        {discounts.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-navy-400">
            No discount codes yet. Create your first with “New code”.
          </p>
        ) : (
          <Table head={["Code", "Type", "Min spend", "Redeemed", "Status", ""]}>
            {discounts.map((d) => (
              <Tr key={d.id}>
                <Td className="font-mono font-medium">{d.code}</Td>
                <Td>{describeKind(d)}</Td>
                <Td className="text-navy-400">
                  {d.minSpendSen ? formatRM(d.minSpendSen / 100) : "—"}
                </Td>
                <Td className="text-navy-400">
                  {d.redeemedCount} / {d.maxRedemptions ?? "∞"}
                </Td>
                <Td>
                  <DiscountToggle id={d.id} active={d.active} />
                </Td>
                <Td className="text-right">
                  <DiscountEditor trigger="edit" discount={d} />
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
