"use client";

import { useEffect, useState } from "react";
import { useCart, cartSubtotal } from "@/stores/cart";
import { formatRM } from "@/lib/format";
import { useMounted } from "@/hooks/useMounted";

/*
  The one part of the success page that touches the cart: it snapshots the
  paid amount once, then empties the bag — like a real post-payment flow.
  The readout is gated on useMounted() because the cart is persisted.
*/
export default function OrderConfirmationLine() {
  const mounted = useMounted();
  const clear = useCart((s) => s.clear);
  // Snapshot the paid amount once — the bag empties right after, like a real post-payment flow
  const [total] = useState(() => cartSubtotal(useCart.getState().items));

  useEffect(() => {
    const t = setTimeout(() => clear(), 400);
    return () => clearTimeout(t);
  }, [clear]);

  return (
    <p className="mt-3 text-[14px] tracking-wide text-navy-400">
      Order <span className="font-medium text-navy">KLM-10249</span> is confirmed
      {mounted && total > 0 && <> — {formatRM(total)} paid via FPX (Maybank2u)</>}.
    </p>
  );
}
