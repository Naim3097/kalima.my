"use client";

import { useEffect } from "react";
import { useCart } from "@/stores/cart";

/*
  Empties the persisted cart once the order has been placed. Client-only: the
  cart lives in localStorage. Rendered on the confirmation page.
*/
export default function ClearCart() {
  const clear = useCart((s) => s.clear);
  useEffect(() => {
    clear();
  }, [clear]);
  return null;
}
