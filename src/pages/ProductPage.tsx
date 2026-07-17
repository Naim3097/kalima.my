import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useProduct, useProducts } from "../hooks/useCatalog";
import { useCart } from "../stores/cart";
import { useWishlist } from "../stores/wishlist";
import { useUi } from "../stores/ui";
import { formatRM } from "../lib/format";
import Button from "../components/ui/Button";
import ProductCard from "../components/ui/ProductCard";
import SectionHeader from "../components/ui/SectionHeader";
import PlaceholderImage from "../components/ui/PlaceholderImage";
import { HeartIcon, ChevronDownIcon } from "../components/ui/Icons";

function Accordion({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-navy/10">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between py-4 cursor-pointer"
        aria-expanded={open}
      >
        <span className="label-caps text-navy">{title}</span>
        <ChevronDownIcon size={14} className={`text-navy-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="pb-5 text-[14px] leading-relaxed tracking-wide text-navy-400">{children}</div>}
    </div>
  );
}

export default function ProductPage() {
  const { slug } = useParams();
  const { data: product, isLoading } = useProduct(slug);
  const { data: all = [] } = useProducts();
  const add = useCart((s) => s.add);
  const { ids, toggle } = useWishlist();
  const setCartOpen = useUi((s) => s.setCartOpen);

  const [colorIndex, setColorIndex] = useState(0);
  const [size, setSize] = useState<string | null>(null);

  useEffect(() => {
    setColorIndex(0);
    setSize(product?.sizes.length === 1 ? product.sizes[0] : null);
  }, [product]);

  if (isLoading) {
    return <div className="mx-auto max-w-7xl px-4 py-24 text-center text-navy-400">Loading…</div>;
  }

  if (!product) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24 text-center">
        <h1 className="font-display text-3xl text-navy">Piece not found</h1>
        <Link to="/collections/best-sellers" className="link-editorial mt-6">
          Shop best sellers
        </Link>
      </div>
    );
  }

  const color = product.colors[colorIndex];
  const wished = ids.includes(product.id);
  const related = all.filter((p) => p.id !== product.id && p.category === product.category).slice(0, 4);

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
      image: color.image ?? (colorIndex === 0 ? product.image : undefined),
    });
    setCartOpen(true);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-12">
      <nav className="label-caps mb-8 text-navy-300">
        <Link to="/" className="hover:text-navy transition-colors">
          Home
        </Link>{" "}
        /{" "}
        <Link to={`/collections/${product.category}`} className="hover:text-navy transition-colors capitalize">
          {product.category}
        </Link>{" "}
        / <span className="text-navy-400">{product.name}</span>
      </nav>

      <div className="grid gap-12 lg:grid-cols-2">
        {/* Gallery — per-colour photo when available */}
        <div className="grid grid-cols-[1fr] gap-4">
          {(() => {
            const mainImage = color.image ?? (colorIndex === 0 ? product.image : undefined);
            return mainImage ? (
              <img
                key={mainImage}
                src={mainImage}
                alt={`${product.name} in ${color.name}`}
                draggable={false}
                className="aspect-[4/5] w-full object-cover object-top select-none"
              />
            ) : (
              <PlaceholderImage
                tone={color.hex}
                className="aspect-[4/5] w-full"
                label={`${product.name} in ${color.name} — photography coming soon`}
              />
            );
          })()}
          <div className="grid grid-cols-3 gap-4">
            {product.colors.slice(0, 3).map((c, i) => {
              const thumb = c.image ?? (i === 0 ? product.image : undefined);
              return (
                <button key={c.name} onClick={() => setColorIndex(i)} className="cursor-pointer" aria-label={`View ${c.name}`}>
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={c.name}
                      draggable={false}
                      className={`aspect-[4/5] w-full object-cover object-top select-none ${i === colorIndex ? "ring-1 ring-navy" : ""}`}
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
              <Link to="/pages/size-guide" className="text-[12px] tracking-wide text-navy-400 underline underline-offset-4 hover:text-navy">
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
            <Button className="flex-1" onClick={addToBag} disabled={!size}>
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
            <Accordion title="Description" defaultOpen>
              {product.description}
            </Accordion>
            <Accordion title="Fabric & Care">
              {product.fabric}. Hand wash cold or delicate machine cycle. Cool iron on reverse. Do not bleach.
            </Accordion>
            <Accordion title="Shipping & Returns">
              Free shipping for orders above RM300. Delivered nationwide via trusted couriers. 14-day easy
              returns — see our returns policy.
            </Accordion>
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <div className="mt-20">
          <SectionHeader title="You may also like" cta={{ label: "View All", to: `/collections/${product.category}` }} />
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 lg:grid-cols-4">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
