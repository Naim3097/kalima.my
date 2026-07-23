import Image from "next/image";
import { formatRM } from "@/lib/format";
import type { OrderDetail, StoreSettings } from "@/lib/admin";

/*
  A single printable packing slip.

  Deliberately a pick-list first and an invoice second: the columns a packer
  actually reads (SKU, colour/size, qty) come before money, and qty is set
  large because miscounting is the expensive mistake. Prices are still shown so
  the slip doubles as the customer's paper record.

  Print behaviour: `break-after-page` lets the bulk route stack many slips in
  one print job, one per sheet. `break-inside-avoid` keeps a line item from
  splitting across a page boundary.
*/
export function PackingSlip({
  order,
  settings,
}: {
  order: OrderDetail;
  settings: StoreSettings | null;
}) {
  const a = order.shippingAddress ?? {};
  const placed = new Date(order.createdAt).toLocaleDateString("en-MY", {
    day: "numeric", month: "short", year: "numeric",
  });
  const units = order.items.reduce((n, i) => n + i.qty, 0);

  return (
    <article className="break-after-page bg-white p-8 text-navy last:break-after-auto print:p-0">
      {/* Header — who it's from, and what this is */}
      <header className="flex items-start justify-between border-b border-navy-200 pb-5">
        <div className="flex items-center gap-3">
          <Image
            src="/brand/kalima-mark-navy.png"
            alt=""
            width={40}
            height={40}
            className="h-10 w-auto"
          />
          <div>
            <p className="font-display text-lg tracking-[0.2em]">
              {settings?.storeName ?? "KALIMA"}
            </p>
            <p className="text-[11px] tracking-wide text-navy-400">
              {settings?.storeEmail}
              {settings?.storePhone ? ` · ${settings.storePhone}` : ""}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="label-caps text-[10px] text-navy-400">Packing Slip</p>
          <p className="font-display text-2xl">{order.reference}</p>
          <p className="text-[11px] tracking-wide text-navy-400">Placed {placed}</p>
        </div>
      </header>

      {/* Ship to */}
      <section className="grid grid-cols-2 gap-8 border-b border-navy-100 py-5">
        <div>
          <p className="label-caps mb-1 text-[10px] text-navy-400">Ship to</p>
          <p className="text-[14px] font-medium">{a.recipient ?? "—"}</p>
          {a.line1 && <p className="text-[13px] tracking-wide">{a.line1}</p>}
          {a.line2 && <p className="text-[13px] tracking-wide">{a.line2}</p>}
          <p className="text-[13px] tracking-wide">
            {[a.postcode, a.city].filter(Boolean).join(" ")}
          </p>
          <p className="text-[13px] tracking-wide">
            {[a.state, a.country ?? "Malaysia"].filter(Boolean).join(", ")}
          </p>
          {(a.phone || order.phone) && (
            <p className="mt-1 text-[13px] tracking-wide">{a.phone ?? order.phone}</p>
          )}
        </div>
        <div>
          <p className="label-caps mb-1 text-[10px] text-navy-400">Order</p>
          <p className="text-[13px] tracking-wide">{order.email}</p>
          <p className="text-[13px] tracking-wide">
            Shipping: {order.shippingMethod ?? "Standard"}
          </p>
          <p className="text-[13px] tracking-wide">
            {units} item{units === 1 ? "" : "s"} · {order.items.length} line
            {order.items.length === 1 ? "" : "s"}
          </p>
          {order.status !== "paid" && (
            <p className="mt-1 text-[12px] font-medium uppercase tracking-wider">
              Status: {order.status}
            </p>
          )}
        </div>
      </section>

      {/* Pick list */}
      <table className="w-full border-collapse py-4 text-left">
        <thead>
          <tr className="border-b border-navy-200">
            <th className="label-caps py-2 text-[10px] text-navy-400">SKU</th>
            <th className="label-caps py-2 text-[10px] text-navy-400">Item</th>
            <th className="label-caps py-2 text-[10px] text-navy-400">Colour / Size</th>
            <th className="label-caps py-2 text-right text-[10px] text-navy-400">Qty</th>
            <th className="label-caps py-2 text-right text-[10px] text-navy-400">Price</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((i, idx) => (
            <tr key={`${i.sku}-${idx}`} className="break-inside-avoid border-b border-navy-50">
              <td className="py-2.5 font-mono text-[11px] tracking-tight">{i.sku}</td>
              <td className="py-2.5 text-[13px]">{i.productName}</td>
              <td className="py-2.5 text-[13px] text-navy-400">
                {i.colorName} · {i.size}
              </td>
              <td className="py-2.5 text-right text-[16px] font-semibold tabular-nums">{i.qty}</td>
              <td className="py-2.5 text-right text-[13px] tabular-nums">
                {formatRM(i.lineSen / 100)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <section className="mt-4 flex justify-end">
        <dl className="w-56 space-y-1 text-[13px]">
          <div className="flex justify-between">
            <dt className="text-navy-400">Subtotal</dt>
            <dd className="tabular-nums">{formatRM(order.subtotalSen / 100)}</dd>
          </div>
          {order.discountSen > 0 && (
            <div className="flex justify-between">
              <dt className="text-navy-400">
                Discount{order.discountCode ? ` (${order.discountCode})` : ""}
              </dt>
              <dd className="tabular-nums">−{formatRM(order.discountSen / 100)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-navy-400">Shipping</dt>
            <dd className="tabular-nums">
              {order.shippingSen === 0 ? "Free" : formatRM(order.shippingSen / 100)}
            </dd>
          </div>
          {order.taxSen > 0 && (
            <div className="flex justify-between">
              <dt className="text-navy-400">Tax</dt>
              <dd className="tabular-nums">{formatRM(order.taxSen / 100)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-navy-200 pt-1 text-[15px] font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatRM(order.totalSen / 100)}</dd>
          </div>
        </dl>
      </section>

      <footer className="mt-8 border-t border-navy-100 pt-4 text-center">
        <p className="text-[12px] tracking-wide text-navy-400">
          Thank you for shopping with {settings?.storeName ?? "Kalima"}.
        </p>
        <p className="mt-0.5 text-[11px] tracking-wide text-navy-300">
          Questions about this order? Quote {order.reference}.
        </p>
      </footer>
    </article>
  );
}
