import { useState } from "react";
import { Link } from "react-router-dom";
import type { Product } from "../../data/catalog";
import { formatRM } from "../../lib/format";
import { useWishlist } from "../../stores/wishlist";
import { HeartIcon } from "./Icons";
import ProductImage from "./ProductImage";

export default function ProductCard({ product }: { product: Product }) {
  const { ids, toggle } = useWishlist();
  const wished = ids.includes(product.id);
  const [activeColor, setActiveColor] = useState(0);
  const color = product.colors[activeColor];
  const tone = color?.hex ?? product.tone;
  // Per-colour shot wins; the default product shot only represents colour #1
  const image = color?.image ?? (activeColor === 0 ? product.image : undefined);

  return (
    <div className="group">
      <div className="relative overflow-hidden">
        <Link to={`/products/${product.slug}`} aria-label={product.name}>
          <ProductImage
            image={image}
            tone={tone}
            alt={product.name}
            className="aspect-[4/5] w-full transition-transform duration-500 group-hover:scale-[1.02]"
          />
        </Link>
        <button
          onClick={() => toggle(product.id)}
          aria-label={wished ? "Remove from wishlist" : "Add to wishlist"}
          className={`absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow-sm transition-colors cursor-pointer ${
            wished ? "text-navy" : "text-navy-400 hover:text-navy"
          }`}
        >
          <HeartIcon size={16} filled={wished} />
        </button>
      </div>

      <div className="mt-4 space-y-2">
        <Link to={`/products/${product.slug}`} className="block text-[15px] hover:underline underline-offset-4">
          {product.name}
        </Link>
        <div className="text-[15px] text-navy-400">{formatRM(product.price)}</div>
        <div className="flex items-center gap-1.5 pt-0.5">
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
