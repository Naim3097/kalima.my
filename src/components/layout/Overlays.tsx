"use client";

import dynamic from "next/dynamic";

/*
  The three overlays are closed on first paint and only ever opened by user
  intent, so none of them belong in the initial bundle. `ssr: false` is
  correct here (not merely an optimisation): each reads open/closed state
  from the Zustand UI store, which is client-only.
*/
const CartDrawer = dynamic(() => import("./CartDrawer"));
const SearchOverlay = dynamic(() => import("./SearchOverlay"));
const MobileMenu = dynamic(() => import("./MobileMenu"));

export default function Overlays() {
  return (
    <>
      <CartDrawer />
      <SearchOverlay />
      <MobileMenu />
    </>
  );
}
