"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useProducts } from "@/hooks/useCatalog";
import { useUi } from "@/stores/ui";
import { formatRM } from "@/lib/format";
import { CloseIcon, SearchIcon } from "@/components/brand/Icons";
import ProductImage from "@/components/brand/ProductImage";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

/*
  Full-width search sheet dropped from the top of the viewport. Built on the
  shadcn Dialog: the primitive owns the backdrop, Escape, focus trap and
  initial focus (the input is the first focusable element), so none of that
  is hand-rolled here.
*/
export default function SearchOverlay() {
  const { searchOpen, setSearchOpen } = useUi();
  const [query, setQuery] = useState("");
  const { data: products = [] } = useProducts();

  useEffect(() => {
    if (searchOpen) setQuery("");
  }, [searchOpen]);

  const results = query.trim()
    ? products.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    : [];

  return (
    <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="top-0 left-0 block w-full max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-0 bg-cream-50 p-0 shadow-xl sm:max-w-none"
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="mx-auto max-w-3xl px-4 py-8">
          <div className="flex items-center gap-4 border-b border-navy/20 pb-4">
            <SearchIcon size={20} className="text-navy-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Kalima…"
              className="flex-1 bg-transparent font-display text-2xl text-navy placeholder:text-navy-300 focus:outline-none"
              aria-label="Search products"
            />
            <DialogClose
              aria-label="Close search"
              className="text-navy-400 hover:text-navy cursor-pointer"
            >
              <CloseIcon size={20} />
            </DialogClose>
          </div>

          {query.trim() && (
            <div className="max-h-[50vh] overflow-y-auto py-4">
              {results.length === 0 ? (
                <p className="py-8 text-center text-[13px] tracking-wide text-navy-400">
                  No results for “{query}”
                </p>
              ) : (
                <ul className="divide-y divide-navy/5">
                  {results.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/products/${p.slug}`}
                        onClick={() => setSearchOpen(false)}
                        className="flex items-center gap-4 py-3 hover:bg-navy-100/40 px-2 -mx-2 transition-colors"
                      >
                        <ProductImage
                          image={p.image}
                          tone={p.tone}
                          alt={p.name}
                          className="h-16 w-14 shrink-0"
                          sizes="56px"
                        />
                        <div>
                          <p className="text-[14px]">{p.name}</p>
                          <p className="text-[13px] text-navy-400">{formatRM(p.price)}</p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
