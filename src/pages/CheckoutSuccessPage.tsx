import { useEffect, useState } from "react";
import { useCart, cartSubtotal } from "../stores/cart";
import { formatRM } from "../lib/format";
import Button from "../components/ui/Button";

export default function CheckoutSuccessPage() {
  const clear = useCart((s) => s.clear);
  // Snapshot the paid amount once — the bag empties right after, like a real post-payment flow
  const [total] = useState(() => cartSubtotal(useCart.getState().items));

  useEffect(() => {
    const t = setTimeout(() => clear(), 400);
    return () => clearTimeout(t);
  }, [clear]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-navy text-2xl text-white">✓</div>
      <h1 className="mt-6 font-display text-4xl text-navy">Terima kasih, Nurul 🤍</h1>
      <p className="mt-3 text-[14px] tracking-wide text-navy-400">
        Order <span className="font-medium text-navy">KLM-10249</span> is confirmed
        {total > 0 && <> — {formatRM(total)} paid via FPX (Maybank2u)</>}.
      </p>

      <div className="mt-10 space-y-3 text-left">
        {[
          { icon: "💬", title: "WhatsApp confirmation sent", body: "Order details delivered to +60 12-345 6789 — tracking link follows automatically when the parcel ships." },
          { icon: "📦", title: "EasyParcel booking queued", body: "Warehouse books the consignment in one click; you'll get the courier + AWB tracking number." },
          { icon: "✨", title: "289 Kalima Club points earned", body: "Points credit after the 14-day return window. You're RM320 away from Gold tier." },
        ].map((step) => (
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
        <Button to="/account">View My Account</Button>
        <Button to="/" variant="outline">
          Back to Home
        </Button>
      </div>
    </div>
  );
}
