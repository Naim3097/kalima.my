import type { Product } from "@/data/catalog";
import ProductCard from "@/components/brand/ProductCard";
import SectionHeader from "@/components/brand/SectionHeader";

/*
  Server Component — the page fetches the catalogue and passes it down; only
  the ProductCard children are client-side (wishlist + colour swatches).
*/
export default function BestSellers({ products }: { products: Product[] }) {
  const bestSellers = products.filter((p) => p.bestSeller).slice(0, 5);

  return (
    <section className="mx-auto max-w-7xl px-4 py-14">
      <SectionHeader title="Best Sellers" cta={{ label: "View All", href: "/collections/best-sellers" }} />
      <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-5">
        {bestSellers.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
