import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import OrderConfirmationLine from "@/components/checkout/OrderConfirmationLine";

export const metadata: Metadata = {
  title: "Order Confirmed",
  description:
    "Your Kalima order is confirmed — WhatsApp confirmation sent, EasyParcel booking queued and Club points on the way.",
};

const STEPS = [
  { icon: "💬", title: "WhatsApp confirmation sent", body: "Order details delivered to +60 12-345 6789 — tracking link follows automatically when the parcel ships." },
  { icon: "📦", title: "EasyParcel booking queued", body: "Warehouse books the consignment in one click; you'll get the courier + AWB tracking number." },
  { icon: "✨", title: "289 Kalima Club points earned", body: "Points credit after the 14-day return window. You're RM320 away from Gold tier." },
];

/*
  Server Component. Only the paid-amount readout touches the persisted cart
  (and clears it after payment), so that single line is a client child.
*/
export default function CheckoutSuccessPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-navy text-2xl text-white">✓</div>
      <h1 className="mt-6 font-display text-4xl text-navy">Terima kasih, Nurul 🤍</h1>
      <OrderConfirmationLine />

      <div className="mt-10 space-y-3 text-left">
        {STEPS.map((step) => (
          <div key={step.title} className="flex gap-4 border border-navy/10 bg-white px-5 py-4">
            <span className="text-xl">{step.icon}</span>
            <div>
              <p className="text-[14px] font-medium text-navy">{step.title}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed tracking-wide text-navy-400">{step.body}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-6 text-[12px] tracking-wide text-navy-300">
        Demo preview — in production this page follows a real gateway webhook confirmation.
      </p>

      <div className="mt-8 flex justify-center gap-4">
        <Button asChild variant="kalima" size="editorial">
          <Link href="/account">View My Account</Link>
        </Button>
        <Button asChild variant="kalimaOutline" size="editorial">
          <Link href="/">Back to Home</Link>
        </Button>
      </div>
    </div>
  );
}
