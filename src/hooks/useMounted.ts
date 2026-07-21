"use client";

import { useEffect, useState } from "react";

/*
  Cart and wishlist are persisted to localStorage, so their values differ
  between the server render (always empty) and the first client render
  (rehydrated). Gate any persisted-store readout on this to avoid a
  hydration mismatch — render the empty state on the server, fill in after mount.
*/
export function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
