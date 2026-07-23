import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader, Pill, Table, Td, Tr } from "@/components/admin/ui";
import { RefundPanel } from "@/components/admin/RefundPanel";
import StatusUpdater from "@/components/admin/StatusUpdater";
import { Button } from "@/components/ui/button";
import { getOrder } from "@/lib/admin";
import { formatRM } from "@/lib/format";

const dateFmt = new Intl.DateTimeFormat("en-MY", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ reference: string }>;
}): Promise<Metadata> {
  const { reference } = await params;
  return { title: `Order ${reference} · Admin` };
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="label-caps text-navy-400">{label}</p>
      <p className="mt-1 text-[13px] text-navy">{value}</p>
    </div>
  );
}

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  const order = await getOrder(reference);
  if (!order) notFound();

  const addr = order.shippingAddress ?? {};
  const addrLines = [addr.line1, addr.line2, [addr.postcode, addr.city].filter(Boolean).join(" "), addr.state]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/admin/orders"
            className="label-caps text-navy-400 transition-colors hover:text-navy"
          >
            ← Orders
          </Link>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="font-display text-3xl text-navy">{order.reference}</h1>
            <Pill value={order.status} />
          </div>
          <p className="mt-1 text-[13px] tracking-wide text-navy-400">
            Placed {dateFmt.format(new Date(order.createdAt))}
            {order.paidAt ? ` · Paid ${dateFmt.format(new Date(order.paidAt))}` : ""}
          </p>
        </div>
        <Button asChild variant="kalimaOutline" size="editorial">
          <Link href={`/admin/orders/${order.reference}/packing-slip`}>Packing slip</Link>
        </Button>
      </div>

      <Card className="px-5 py-4">
        <p className="label-caps text-navy-400">Update status</p>
        <div className="mt-3">
          <StatusUpdater reference={order.reference} status={order.status} />
        </div>
      </Card>

      <RefundPanel
        reference={order.reference}
        totalSen={order.totalSen}
        status={order.status}
        refundedSen={order.refundedSen}
        refundedAt={order.refundedAt}
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader title="Customer" />
          <div className="space-y-3 px-5 py-4">
            <Field label="Email" value={order.email} />
            <Field label="Phone" value={order.phone ?? "—"} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Shipping address" />
          <div className="space-y-3 px-5 py-4">
            <Field label="Recipient" value={addr.recipient ?? "—"} />
            <Field label="Address" value={addrLines || "—"} />
            {order.shippingMethod && <Field label="Method" value={order.shippingMethod} />}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Line items" />
        <Table head={["Product", "Colour", "Size", "SKU", "Qty", "Unit", "Line total"]}>
          {order.items.map((it, i) => (
            <Tr key={`${it.sku}-${i}`}>
              <Td className="font-medium">{it.productName}</Td>
              <Td className="text-navy-400">{it.colorName}</Td>
              <Td className="text-navy-400">{it.size}</Td>
              <Td className="text-navy-400">{it.sku}</Td>
              <Td>{it.qty}</Td>
              <Td className="text-navy-400">{formatRM(it.unitSen / 100)}</Td>
              <Td>{formatRM(it.lineSen / 100)}</Td>
            </Tr>
          ))}
        </Table>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader title="Summary" />
          <dl className="space-y-2 px-5 py-4 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-navy-400">Subtotal</dt>
              <dd className="text-navy">{formatRM(order.subtotalSen / 100)}</dd>
            </div>
            {order.discountSen > 0 && (
              <div className="flex justify-between">
                <dt className="text-navy-400">
                  Discount{order.discountCode ? ` (${order.discountCode})` : ""}
                </dt>
                <dd className="text-emerald-700">−{formatRM(order.discountSen / 100)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-navy-400">Shipping</dt>
              <dd className="text-navy">{formatRM(order.shippingSen / 100)}</dd>
            </div>
            <div className="flex justify-between border-t border-navy/10 pt-2 font-medium">
              <dt className="text-navy">Total</dt>
              <dd className="text-navy">{formatRM(order.totalSen / 100)}</dd>
            </div>
          </dl>
        </Card>

        {order.payment && (
          <Card>
            <CardHeader title="Payment" />
            <div className="space-y-3 px-5 py-4">
              <Field label="Provider" value={order.payment.provider} />
              <Field label="Reference" value={order.payment.providerRef ?? "—"} />
              <div>
                <p className="label-caps text-navy-400">Status</p>
                <div className="mt-1">
                  <Pill value={order.payment.status} />
                </div>
              </div>
              <Field label="Amount" value={formatRM(order.payment.amountSen / 100)} />
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
