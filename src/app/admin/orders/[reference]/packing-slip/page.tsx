import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PackingSlip } from "@/components/admin/PackingSlip";
import { PrintToolbar } from "@/components/admin/PrintToolbar";
import { getOrder, getStoreSettings } from "@/lib/admin";

type Params = { params: Promise<{ reference: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { reference } = await params;
  return { title: `Packing slip ${reference} · Admin`, robots: { index: false, follow: false } };
}

/** One order's packing slip, ready to print. */
export default async function PackingSlipPage({ params }: Params) {
  const { reference } = await params;
  const [order, settings] = await Promise.all([getOrder(reference), getStoreSettings()]);
  if (!order) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <PrintToolbar backHref={`/admin/orders/${reference}`} label={`Order ${reference}`} />
      <div className="border border-navy-100 print:border-0">
        <PackingSlip order={order} settings={settings} />
      </div>
    </div>
  );
}
