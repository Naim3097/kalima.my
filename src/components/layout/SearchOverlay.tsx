import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useProducts } from "../../hooks/useCatalog";
import { useUi } from "../../stores/ui";
import { formatRM } from "../../lib/format";
import { CloseIcon, SearchIcon } from "../ui/Icons";
import ProductImage from "../ui/ProductImage";

export default function SearchOverlay() {
  const { searchOpen, setSearchOpen } = useUi();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: products = [] } = useProducts();

  useEffect(() => {
    if (searchOpen) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [searchOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSearchOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSearchOpen]);

  const results = query.trim()
    ? products.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    : [];

  if (!searchOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-navy-900/40" onClick={() => setSearchOpen(false)}>
      <div className="bg-cream-50 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto max-w-3xl px-4 py-8">
          <div className="flex items-center gap-4 border-b border-navy/20 pb-4">
            <SearchIcon size={20} className="text-navy-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Kalima…"
              className="flex-1 bg-transparent font-display text-2xl text-navy placeholder:text-navy-300 focus:outline-none"
              aria-label="Search products"
            />
            <button onClick={() => setSearchOpen(false)} aria-label="Close search" className="text-navy-400 hover:text-navy cursor-pointer">
              <CloseIcon size={20} />
            </button>
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
                        to={`/products/${p.slug}`}
                        onClick={() => setSearchOpen(false)}
                        className="flex items-center gap-4 py-3 hover:bg-navy-100/40 px-2 -mx-2 transition-colors"
                      >
                        <ProductImage image={p.image} tone={p.tone} alt={p.name} className="h-16 w-14 shrink-0" />
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
      </div>
    </div>
  );
}
