"use client";

import { useMemo, useState } from "react";
import { effectivePrice, type Product } from "@/data/catalog";
import ProductCard from "@/components/brand/ProductCard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Sort = "featured" | "price-asc" | "price-desc";

/*
  Client island for the collection listing — the sort control is the only
  interactive piece, so the page itself stays a Server Component.
*/
export default function CollectionGrid({ products }: { products: Product[] }) {
  const [sort, setSort] = useState<Sort>("featured");

  const sorted = useMemo(() => {
    const list = [...products];
    // Sort on what the shopper pays — a sale item sorted by its struck-through
    // list price would sit in the wrong place in "Price: Low to High".
    if (sort === "price-asc") list.sort((a, b) => effectivePrice(a) - effectivePrice(b));
    if (sort === "price-desc") list.sort((a, b) => effectivePrice(b) - effectivePrice(a));
    return list;
  }, [products, sort]);

  return (
    <>
      <div className="mb-8 flex items-center justify-between border-y border-navy/10 py-3">
        <p className="text-[12px] tracking-wide text-navy-400">
          {sorted.length} {sorted.length === 1 ? "piece" : "pieces"}
        </p>
        <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
          <SelectTrigger
            aria-label="Sort products"
            className="label-caps h-auto cursor-pointer border-0 bg-transparent p-0 text-navy shadow-none focus-visible:ring-0 data-[size=default]:h-auto"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="featured">Sort: Featured</SelectItem>
            <SelectItem value="price-asc">Price: Low to High</SelectItem>
            <SelectItem value="price-desc">Price: High to Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {sorted.length === 0 ? (
        <p className="py-20 text-center text-navy-400">New pieces arriving soon.</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
          {sorted.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </>
  );
}
