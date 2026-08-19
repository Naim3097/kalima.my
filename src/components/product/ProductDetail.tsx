"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import {
  discountPercent,
  effectivePrice,
  variantKey,
  type Product,
  type ProductAddon,
} from "@/data/catalog";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

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
  /* Ticked add-ons, by product_addons row id. Cleared after a successful add
     so the next configuration starts clean. */
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const color = product.colors[colorIndex];
  const wished = mounted && ids.includes(product.id);
  const mainImage = color.image ?? (colorIndex === 0 ? product.image : undefined);
  // What is actually charged — the bag, the points estimate and the price line
  // all read this, so a sale can't be shown here and dropped in the bag.
  const payable = effectivePrice(product);
  const off = discountPercent(product);

  /*
    Stock, resolved for the selected colour. Undefined stockByVariant (the seed
    fallback) means "unknown", which we treat as available so the offline demo
    still adds to bag; a real catalogue always carries the map. A size with no
    entry for this colour is not a real variant, so it counts as unavailable.
  */
  const stockOf = (sz: string): number | undefined =>
    product.stockByVariant?.[variantKey(color.name, sz)];
  const sizeAvailable = (sz: string) => {
    const s = stockOf(sz);
    return s === undefined ? product.stockByVariant === undefined : s > 0;
  };
  const selectedInStock = size ? sizeAvailable(size) : false;
  // Every size of this colour gone → the colour itself is sold out.
  const colorSoldOut = product.stockByVariant !== undefined && !product.sizes.some(sizeAvailable);

  /*
    Switching colour can strand the chosen size — Black/M may be in stock while
    Cream/M is gone. Drop a size that the new colour cannot fulfil, so the
    shopper never lands on a selection that silently can't be added.
  */
  const pickColor = (i: number) => {
    setColorIndex(i);
    const c = product.colors[i];
    if (size && product.stockByVariant && (product.stockByVariant[variantKey(c.name, size)] ?? 0) <= 0) {
      setSize(null);
    }
  };

  /*
    An add-on is offered in the SIZE the shopper picked on this product — that
    is the whole promise of "matching". So availability is a question about the
    add-on's own stock at that size, and cannot be answered before a size is
    chosen.
  */
  const addons = product.addons ?? [];
  const addonAvailable = (a: ProductAddon) => Boolean(size) && (a.stockBySize[size!] ?? 0) > 0;

  /*
    Choosing a size can strand an add-on the same way choosing a colour can
    strand a size (see pickColor): the pants may exist in M and be gone in L.
    Prune on every size change, so a tick made at M cannot survive into an L
    that has nothing to sell and reach the bag as a line checkout will reject.
  */
  const pickSize = (s: string) => {
    setSize(s);
    setChosen((prev) => {
      const next = new Set([...prev].filter((id) => {
        const a = addons.find((x) => x.id === id);
        return a ? (a.stockBySize[s] ?? 0) > 0 : false;
      }));
      return next.size === prev.size ? prev : next;
    });
  };

  const toggleAddon = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const addToBag = () => {
    if (!size || !selectedInStock) return;
    add({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      price: payable,
      color: color.name,
      size,
      tone: color.hex,
      image: mainImage,
    });

    /*
      Each add-on goes in as its OWN cart line, carrying the add-on product's
      slug and pinned colour with the parent's size. resolveCartLines maps
      slug+colour+size straight to a variant id, so the line is priced, stocked
      and marketplace-synced by exactly the same paths as any other — no
      special case anywhere downstream.
    */
    const picked = addons.filter((a) => chosen.has(a.id) && addonAvailable(a));
    for (const a of picked) {
      add({
        productId: a.productId,
        slug: a.slug,
        name: a.name,
        price: a.price,
        color: a.colorName,
        size,
        tone: a.colorHex,
        image: a.image,
      });
    }

    toast.success(`${product.name} added to your bag`, {
      description:
        `${color.name} · ${size}` +
        (picked.length ? ` — with ${picked.map((a) => a.name).join(", ")}` : ""),
    });
    setChosen(new Set());
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
                onClick={() => pickColor(i)}
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
        <div className="mt-3 flex flex-wrap items-baseline gap-3">
          {product.salePrice != null ? (
            <>
              <p className="text-xl text-navy">{formatRM(product.salePrice)}</p>
              <p className="text-[15px] text-navy-300 line-through">{formatRM(product.price)}</p>
              <span className="label-caps bg-navy px-2 py-1 text-[10px] text-white">
                {off}% off
              </span>
            </>
          ) : (
            <p className="text-xl text-navy">{formatRM(product.price)}</p>
          )}
        </div>
        <p className="mt-2 text-[12px] tracking-wide text-navy-300">
          Kalima Club members earn {Math.round(payable)} points with this piece
        </p>

        <div className="mt-8">
          <p className="label-caps mb-3 text-navy-400">
            Colour — <span className="text-navy">{color.name}</span>
          </p>
          {/*
            WRAPS, like the size row below it. A shawl comes in ten colours, and
            ten 32px swatches plus their gaps are ~410px — wider than a phone,
            so the whole PAGE scrolled sideways and the title, price and buttons
            sat half off-screen. Nothing here was visibly broken on a desktop,
            which is why it survived.
          */}
          <div className="flex flex-wrap gap-2.5">
            {product.colors.map((c, i) => (
              <button
                key={c.name}
                title={c.name}
                onClick={() => pickColor(i)}
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
          <div className="mb-3 flex items-center justify-between gap-4">
            <p className="label-caps text-navy-400">Size</p>
            <div className="flex items-center gap-4">
            {/* This product's own chart when it has one; the general guide page
                otherwise, so the link is never a dead end. */}
            {product.sizeChart ? (
              <Dialog>
                <DialogTrigger className="cursor-pointer text-[12px] tracking-wide text-navy-400 underline underline-offset-4 hover:text-navy">
                  Size guide
                </DialogTrigger>
                <DialogContent className="max-w-3xl gap-0 border-navy/10 bg-white p-0 sm:max-w-3xl">
                  <DialogHeader className="border-b border-navy/10 px-5 py-4">
                    <DialogTitle className="label-caps !text-[12px] text-navy">
                      {product.name} — size guide
                    </DialogTitle>
                    <DialogDescription className="text-[12px] tracking-wide text-navy-400">
                      Measurements in centimetres. Between two sizes? Take the larger.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="max-h-[70vh] overflow-auto bg-cream-50 p-4">
                    <Image
                      src={product.sizeChart}
                      alt={`Size guide for ${product.name}`}
                      width={1400}
                      height={1000}
                      sizes="(max-width: 768px) 100vw, 720px"
                      className="h-auto w-full object-contain"
                    />
                  </div>
                </DialogContent>
              </Dialog>
            ) : (
              <Link
                href="/pages/size-guide"
                className="text-[12px] tracking-wide text-navy-400 underline underline-offset-4 hover:text-navy"
              >
                Size guide
              </Link>
            )}
            {/* Only where the piece can actually be tailored — the link invites
                a DM the team then has to honour. */}
            {product.offersCustomSizing && (
              <Link
                href="/pages/custom-sizing"
                className="text-[12px] tracking-wide text-navy-400 underline underline-offset-4 hover:text-navy"
              >
                Custom sizing
              </Link>
            )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {product.sizes.map((s) => {
              const available = sizeAvailable(s);
              return (
                <button
                  key={s}
                  onClick={() => available && pickSize(s)}
                  disabled={!available}
                  aria-disabled={!available}
                  title={available ? undefined : "Sold out in this colour"}
                  className={`min-w-12 border px-4 py-2.5 text-[13px] tracking-wide transition-colors ${
                    !available
                      ? "cursor-not-allowed border-navy/10 text-navy-300 line-through"
                      : size === s
                        ? "cursor-pointer border-navy bg-navy text-white"
                        : "cursor-pointer border-navy/25 text-navy hover:border-navy"
                  }`}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        {/*
          Matching pieces. Each is a separate product with its own stock, so a
          row can be sold out in the chosen size while the parent is fine — and
          nothing can be judged at all until a size is picked, because the size
          is what the add-on inherits.
        */}
        {addons.length > 0 && (
          <div className="mt-8">
            <p className="label-caps mb-3 text-navy-400">Add ons</p>
            <div className="space-y-1">
              {addons.map((a) => {
                const available = addonAvailable(a);
                const ticked = chosen.has(a.id);
                return (
                  <label
                    key={a.id}
                    className={`flex items-center gap-3 py-1.5 text-[13px] tracking-wide ${
                      available ? "cursor-pointer text-navy" : "cursor-not-allowed text-navy-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={ticked && available}
                      disabled={!available}
                      onChange={() => toggleAddon(a.id)}
                      className="h-4 w-4 shrink-0 cursor-pointer accent-navy disabled:cursor-not-allowed"
                    />
                    <span className="flex-1">
                      {a.name}
                      <span className="text-navy-400"> · {a.colorName}</span>
                    </span>
                    {/* Say WHY it cannot be ticked. "Sold out" with no size
                        named reads as the whole product being gone. */}
                    <span className={available ? "" : "text-[12px]"}>
                      {available
                        ? formatRM(a.price)
                        : size
                          ? `Sold out in ${size}`
                          : "Select a size"}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-9 flex gap-3">
          <Button
            variant="kalima"
            size="editorial"
            className="flex-1"
            onClick={addToBag}
            disabled={!size || !selectedInStock}
          >
            {colorSoldOut
              ? "Sold Out"
              : !size
                ? "Select a Size"
                : !selectedInStock
                  ? "Sold Out"
                  : "Add to Bag"}
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
                We ship worldwide. Delivery is calculated at checkout from your address and
                the courier you choose. 14-day easy returns — see our returns policy.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>
    </div>
  );
}
