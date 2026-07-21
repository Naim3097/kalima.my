"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { Product } from "@/data/catalog";
import { formatRM } from "@/lib/format";
import { useCart } from "@/stores/cart";
import { useWishlist } from "@/stores/wishlist";
import { useUi } from "@/stores/ui";
import { useMounted } from "@/hooks/useMounted";
import { HeartIcon } from "@/components/brand/Icons";
import PlaceholderImage from "@/components/brand/PlaceholderImage";
import ProductImage from "@/components/brand/ProductImage";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

/*
  Client island for the PDP — colour/size selection, add-to-bag, wishlist and
  the detail accordions. Breadcrumb, heading and the related rail stay on the
  server (see the route's page.tsx).
*/
export default function ProductDetail({ product }: { product: Product }) {
  const add = useCart((s) => s.add);
  const { ids, toggle } = useWishlist();
  const setCartOpen = useUi((s) => s.setCartOpen);
  const mounted = useMounted();

  const [colorIndex, setColorIndex] = useState(0);
  const [size, setSize] = useState<string | null>(
    product.sizes.length === 1 ? product.sizes[0] : null,
  );

  const color = product.colors[colorIndex];
  const wished = mounted && ids.includes(product.id);
  const mainImage = color.image ?? (colorIndex === 0 ? product.image : undefined);

  const addToBag = () => {
    if (!size) return;
    add({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      price: product.price,
      color: color.name,
      size,
      tone: color.hex,
      image: mainImage,
    });
    toast.success(`${product.name} added to your bag`, {
      description: `${color.name} · ${size}`,
    });
    setCartOpen(true);
  };

  return (
    <div className="grid gap-12 lg:grid-cols-2">
      {/* Gallery — per-colour photo when available */}
      <div className="grid grid-cols-[1fr] gap-4">
        {mainImage ? (
          <ProductImage
            key={mainImage}
            image={mainImage}
            tone={color.hex}
            alt={`${product.name} in ${color.name}`}
            className="aspect-[4/5] w-full"
            sizes="(max-width: 1024px) 100vw, 50vw"
            priority
          />
        ) : (
          <PlaceholderImage
            tone={color.hex}
            className="aspect-[4/5] w-full"
            label={`${product.name} in ${color.name} — photography coming soon`}
          />
        )}
        <div className="grid grid-cols-3 gap-4">
          {product.colors.slice(0, 3).map((c, i) => {
            const thumb = c.image ?? (i === 0 ? product.image : undefined);
            return (
              <button
                key={c.name}
                onClick={() => setColorIndex(i)}
                className="cursor-pointer"
                aria-label={`View ${c.name}`}
              >
                {thumb ? (
                  <ProductImage
                    image={thumb}
                    tone={c.hex}
                    alt={c.name}
                    className={`aspect-[4/5] w-full ${i === colorIndex ? "ring-1 ring-navy" : ""}`}
                    sizes="(max-width: 1024px) 33vw, 17vw"
                  />
                ) : (
                  <PlaceholderImage
                    tone={c.hex}
                    mark={false}
                    className={`aspect-[4/5] w-full ${i === colorIndex ? "ring-1 ring-navy" : ""}`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Details */}
      <div className="max-w-lg">
        <h1 className="font-display text-4xl text-navy">{product.name}</h1>
        <p className="mt-3 text-xl text-navy">{formatRM(product.price)}</p>
        <p className="mt-2 text-[12px] tracking-wide text-navy-300">
          Kalima Club members earn {Math.round(product.price)} points with this piece
        </p>

        <div className="mt-8">
          <p className="label-caps mb-3 text-navy-400">
            Colour — <span className="text-navy">{color.name}</span>
          </p>
          <div className="flex gap-2.5">
            {product.colors.map((c, i) => (
              <button
                key={c.name}
                title={c.name}
                onClick={() => setColorIndex(i)}
                aria-label={`Colour: ${c.name}`}
                className={`h-8 w-8 rounded-full border-2 transition-transform cursor-pointer ${
                  i === colorIndex ? "border-navy scale-105" : "border-black/10 hover:border-navy/40"
                }`}
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>
        </div>

        <div className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <p className="label-caps text-navy-400">Size</p>
            <Link
              href="/pages/size-guide"
              className="text-[12px] tracking-wide text-navy-400 underline underline-offset-4 hover:text-navy"
            >
              Size guide
            </Link>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {product.sizes.map((s) => (
              <button
                key={s}
                onClick={() => setSize(s)}
                className={`min-w-12 border px-4 py-2.5 text-[13px] tracking-wide transition-colors cursor-pointer ${
                  size === s
                    ? "border-navy bg-navy text-white"
                    : "border-navy/25 text-navy hover:border-navy"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-9 flex gap-3">
          <Button
            variant="kalima"
            size="editorial"
            className="flex-1"
            onClick={addToBag}
            disabled={!size}
          >
            {size ? "Add to Bag" : "Select a Size"}
          </Button>
          <button
            onClick={() => toggle(product.id)}
            aria-label={wished ? "Remove from wishlist" : "Add to wishlist"}
            className={`flex w-14 items-center justify-center border transition-colors cursor-pointer ${
              wished ? "border-navy text-navy" : "border-navy/25 text-navy-400 hover:border-navy hover:text-navy"
            }`}
          >
            <HeartIcon size={18} filled={wished} />
          </button>
        </div>

        <div className="mt-10">
          <Accordion type="multiple" defaultValue={["description"]}>
            <AccordionItem value="description" className="border-b border-navy/10 last:border-b-0">
              <AccordionTrigger className="label-caps items-center py-4 text-navy hover:no-underline cursor-pointer [&>svg]:translate-y-0 [&>svg]:text-navy-400">
                Description
              </AccordionTrigger>
              <AccordionContent className="pb-5 text-[14px] leading-relaxed tracking-wide text-navy-400">
                {product.description}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="fabric" className="border-b border-navy/10 last:border-b-0">
              <AccordionTrigger className="label-caps items-center py-4 text-navy hover:no-underline cursor-pointer [&>svg]:translate-y-0 [&>svg]:text-navy-400">
                Fabric &amp; Care
              </AccordionTrigger>
              <AccordionContent className="pb-5 text-[14px] leading-relaxed tracking-wide text-navy-400">
                {product.fabric}. Hand wash cold or delicate machine cycle. Cool iron on reverse. Do not bleach.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="shipping" className="border-b border-navy/10 last:border-b-0">
              <AccordionTrigger className="label-caps items-center py-4 text-navy hover:no-underline cursor-pointer [&>svg]:translate-y-0 [&>svg]:text-navy-400">
                Shipping &amp; Returns
              </AccordionTrigger>
              <AccordionContent className="pb-5 text-[14px] leading-relaxed tracking-wide text-navy-400">
                Free shipping for orders above RM300. Delivered nationwide via trusted couriers. 14-day easy
                returns — see our returns policy.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>
    </div>
  );
}
