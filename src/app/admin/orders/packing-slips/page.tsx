import type { Metadata } from "next";
import Link from "next/link";
import { PackingSlip } from "@/components/admin/PackingSlip";
import { PrintToolbar } from "@/components/admin/PrintToolbar";
import { getOrdersForPacking, getStoreSettings, type OrderStatus } from "@/lib/admin";

export const metadata: Metadata = {
  title: "Packing slips · Admin",
  robots: { index: false, follow: false },
};

type Search = { searchParams: Promise<{ status?: string; refs?: string }> };

const PRINTABLE: OrderStatus[] = ["paid", "fulfilled"];

/*
  The daily run: every slip that needs packing, in one print job, one per sheet.

  Defaults to `paid` — orders that are settled but not yet sent, which is
  exactly the pile a packer works through each morning. An explicit `refs` list
  wins over the status filter for printing a hand-picked batch.
*/
export default async function PackingSlipsPage({ searchParams }: Search) {
  const { status, refs } = await searchParams;
  const references = refs?.split(",").map((r) => r.trim()).filter(Boolean);
  const chosen = (PRINTABLE.includes(status as OrderStatus) ? status : "paid") as OrderStatus;

  const [orders, settings] = await Promise.all([
    getOrdersForPacking(references?.length ? { references } : { status: chosen }),
    getStoreSettings(),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PrintToolbar backHref="/admin/orders" label="Orders" />

      {orders.length === 0 ? (
        <div className="rounded border border-navy-100 bg-white p-8 text-center print:hidden">
          <p className="text-[13px] tracking-wide text-navy-400">
            Nothing to pack — no orders with status “{chosen}”.
          </p>
          <Link
            href="/admin/orders"
            className="label-caps mt-3 inline-block text-[11px] text-navy-400 hover:text-navy"
          >
            Back to orders
          </Link>
        </div>
      ) : (
        <>
          <p className="mb-3 text-[12px] tracking-wide text-navy-400 print:hidden">
            {orders.length} slip{orders.length === 1 ? "" : "s"}
            {references?.length ? " (selected orders)" : ` · status “${chosen}”`} — each prints
            on its own sheet.
          </p>
          <div className="space-y-6 print:space-y-0">
            {orders.map((o) => (
              <div key={o.reference} className="border border-navy-100 print:border-0">
                <PackingSlip order={o} settings={settings} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
