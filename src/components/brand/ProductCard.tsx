"use client";

import { useState } from "react";
import Link from "next/link";
import { discountPercent, type Product } from "@/data/catalog";
import { formatRM } from "@/lib/format";
import { useWishlist } from "@/stores/wishlist";
import { useMounted } from "@/hooks/useMounted";
import { track } from "@/lib/meta/track";
import { HeartIcon } from "./Icons";
import ProductImage from "./ProductImage";

export default function ProductCard({ product }: { product: Product }) {
  const { ids, toggle } = useWishlist();
  const mounted = useMounted();
  const wished = mounted && ids.includes(product.id);
  const [activeColor, setActiveColor] = useState(0);
  const color = product.colors[activeColor];
  const tone = color?.hex ?? product.tone;
  // Per-colour shot wins; the default product shot only represents colour #1
  const image = color?.image ?? (activeColor === 0 ? product.image : undefined);
  const off = discountPercent(product);

  return (
    <div className="group">
      <div className="relative overflow-hidden">
        <Link href={`/products/${product.slug}`} aria-label={product.name}>
          <ProductImage
            image={image}
            tone={tone}
            alt={product.name}
            className="aspect-[4/5] w-full transition-transform duration-500 group-hover:scale-[1.02]"
          />
        </Link>
        {off > 0 && (
          <span className="label-caps pointer-events-none absolute left-3 top-3 bg-navy px-2 py-1 text-[10px] text-white">
            {off}% off
          </span>
        )}
        <button
          onClick={() => {
            /*
              ONLY THE ADD HALF. This control is a toggle, so reporting on every
              press would count a shopper who changed their mind as two
              AddToWishlist events — and the second one for an action that
              removed the piece. `wished` is the state BEFORE this press.
            */
            if (!wished) track("AddToWishlist", { items: [{ slug: product.slug, qty: 1 }] });
            toggle(product.id);
          }}
          aria-label={wished ? "Remove from wishlist" : "Add to wishlist"}
          className={`absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow-sm transition-colors cursor-pointer ${
            wished ? "text-navy" : "text-navy-400 hover:text-navy"
          }`}
        >
          <HeartIcon size={16} filled={wished} />
        </button>
      </div>

      <div className="mt-4 space-y-2">
        <Link
          href={`/products/${product.slug}`}
          className="block text-[15px] hover:underline underline-offset-4"
        >
          {product.name}
        </Link>
        <div className="flex items-baseline gap-2 text-[15px]">
          {product.salePrice != null ? (
            <>
              <span className="text-navy-300 line-through">{formatRM(product.price)}</span>
              <span className="font-medium text-navy">{formatRM(product.salePrice)}</span>
            </>
          ) : (
            <span className="text-navy-400">{formatRM(product.price)}</span>
          )}
        </div>
        {/* Wraps for the same reason the product page's swatches do: ten
            colours need ~194px and a card is ~169px on a 390px phone. The grid
            track is minmax(0,1fr) so this could never scroll the page, but the
            swatches would spill into the card beside it. */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {product.colors.map((c, i) => (
            <button
              key={c.name}
              title={c.name}
              aria-label={`Colour: ${c.name}`}
              onClick={() => setActiveColor(i)}
              className={`h-3.5 w-3.5 rounded-full border transition-transform cursor-pointer ${
                i === activeColor ? "border-navy scale-110" : "border-black/10"
              }`}
              style={{ backgroundColor: c.hex }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
