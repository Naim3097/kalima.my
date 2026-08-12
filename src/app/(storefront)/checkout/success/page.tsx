import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { formatRM } from "@/lib/format";
import { getOrderByReference, reconcileOrderPayment } from "@/lib/commerce";
import { Button } from "@/components/ui/button";
import ClearCart from "@/components/checkout/ClearCart";

export const metadata: Metadata = {
  title: "Order received",
  description: "Your Kalima order has been received.",
};

/*
  Reads the just-placed order from the httpOnly cookie set by placeOrder (keeps
  the email out of the URL) and shows it status-aware. Never marks anything
  paid — that only happens via the gateway webhook.
*/
export default async function CheckoutSuccessPage() {
  const jar = await cookies();
  const raw = jar.get("kalima_order")?.value;

  let order = null;
  if (raw) {
    try {
      const { reference, email } = JSON.parse(raw) as { reference: string; email: string };
      order = await getOrderByReference(reference, email);
    } catch {
      order = null;
    }
  }

  if (!order) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <h1 className="font-display text-3xl text-navy">No recent order found</h1>
        <p className="mt-3 text-[14px] tracking-wide text-navy-400">
          If you&apos;ve just ordered, check your email for confirmation.
        </p>
        <div className="mt-8 flex justify-center gap-4">
          <Button asChild variant="kalima" size="editorial"><Link href="/account">My Account</Link></Button>
          <Button asChild variant="kalimaOutline" size="editorial"><Link href="/">Home</Link></Button>
        </div>
      </div>
    );
  }

  let paid = order.status === "paid" || order.status === "fulfilled" || order.status === "completed";

  /*
    The shopper is back from the gateway but the order still reads unpaid. That
    is either a callback we haven't received yet, or a payment they cancelled —
    and cancellations are never pushed, so waiting would mean waiting forever.
    Ask the gateway directly, once, and say something definite either way.
  */
  let failed = false;
  if (!paid && (order.status === "pending" || order.status === "awaiting_payment")) {
    const verdict = await reconcileOrderPayment(order.reference).catch(() => "pending" as const);
    if (verdict === "paid") paid = true;
    if (verdict === "failed") failed = true;
  }

  const recipient =
    (order.shipping_address as { recipient?: string } | null)?.recipient?.split(" ")[0] ?? "there";

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <ClearCart />

      <div
        className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full text-2xl ${
          failed ? "border border-navy/20 bg-cream-50 text-navy" : "bg-navy text-white"
        }`}
      >
        {failed ? "!" : "✓"}
      </div>
      <h1 className="mt-6 font-display text-4xl text-navy">
        {failed ? "Payment not completed" : `Terima kasih, ${recipient} 🤍`}
      </h1>
      <p className="mt-3 text-[14px] tracking-wide text-navy-400">
        Order <span className="font-medium text-navy">{order.reference}</span>{" "}
        {paid
          ? "is confirmed and being prepared."
          : failed
            ? "is still waiting for payment."
            : "has been received."}
      </p>

      {failed && (
        <p className="mx-auto mt-6 max-w-md border border-navy/15 bg-cream-50 px-4 py-3 text-[13px] leading-relaxed text-navy-400">
          No confirmation came back from the bank. If you cancelled, you have not been
          charged. Your order is saved — you can pay for it from your account, or contact
          us and we&apos;ll help.
        </p>
      )}

      {!paid && !failed && (
        <p className="mx-auto mt-6 max-w-md border border-navy/15 bg-cream-50 px-4 py-3 text-[13px] leading-relaxed text-navy-400">
          We&apos;ll confirm by email the moment your payment is processed. Your items are
          reserved against this order.
        </p>
      )}

      {/* Order summary */}
      <div className="mt-10 border border-navy/10 bg-white text-left">
        <ul className="divide-y divide-navy/5 px-5">
          {order.items.map((i, idx) => (
            <li key={idx} className="flex items-center justify-between py-4 text-[13px]">
              <span className="text-navy">
                {i.product_name}
                <span className="text-navy-400"> · {i.color_name} · {i.size} × {i.qty}</span>
              </span>
              <span className="text-navy">{formatRM(i.line_total_sen / 100)}</span>
            </li>
          ))}
        </ul>
        <dl className="space-y-2 border-t border-navy/10 px-5 py-4 text-[13px]">
          <div className="flex justify-between text-navy-400"><dt>Subtotal</dt><dd>{formatRM(order.subtotal_sen / 100)}</dd></div>
          {order.discount_sen > 0 && (
            <div className="flex justify-between text-emerald-700"><dt>Discount</dt><dd>−{formatRM(order.discount_sen / 100)}</dd></div>
          )}
          <div className="flex justify-between text-navy-400"><dt>Shipping</dt><dd>{order.shipping_sen === 0 ? "FREE" : formatRM(order.shipping_sen / 100)}</dd></div>
          <div className="flex justify-between border-t border-navy/10 pt-3 text-[15px] text-navy">
            <dt className="font-medium">Total</dt>
            <dd className="font-display text-lg">{formatRM(order.total_sen / 100)}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-8 flex justify-center gap-4">
        <Button asChild variant="kalima" size="editorial"><Link href="/account">View my orders</Link></Button>
        <Button asChild variant="kalimaOutline" size="editorial"><Link href="/">Continue shopping</Link></Button>
      </div>
    </div>
  );
}
