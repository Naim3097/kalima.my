"use client";

import Link from "next/link";
import type { Product } from "@/data/catalog";
import { useWishlist } from "@/stores/wishlist";
import { useMounted } from "@/hooks/useMounted";
import ProductCard from "@/components/brand/ProductCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/*
  The wishlist lives in a persisted Zustand store, so the readout only exists
  on the client. Gate on useMounted() and render placeholders until hydration
  settles to avoid a mismatch.

  The catalog arrives as a prop from the server page rather than being read
  here: the data layer is server-only now, and passing it down avoids a second
  client-side fetch for data the page already has.
*/
export default function WishlistGrid({ products }: { products: Product[] }) {
  const ids = useWishlist((s) => s.ids);
  const mounted = useMounted();
  const wished = mounted ? products.filter((p) => ids.includes(p.id)) : [];

  if (!mounted) {
    return (
      <div className="mt-10 grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-4">
            <Skeleton className="aspect-[4/5] w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ))}
      </div>
    );
  }

  if (wished.length === 0) {
    return (
      <div className="py-20 text-center">
        <p className="font-display text-xl text-navy">Nothing saved yet</p>
        <p className="mt-2 text-[14px] tracking-wide text-navy-400">
          Tap the heart on any piece to keep it here.
        </p>
        <div className="mt-8">
          <Button asChild variant="kalima" size="editorial">
            <Link href="/collections/best-sellers">Shop Best Sellers</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-10 grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
      {wished.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}
