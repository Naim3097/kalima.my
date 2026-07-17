import { useProducts } from "../../hooks/useCatalog";
import ProductCard from "../ui/ProductCard";
import SectionHeader from "../ui/SectionHeader";

export default function BestSellers() {
  const { data: products = [] } = useProducts();
  const bestSellers = products.filter((p) => p.bestSeller).slice(0, 5);

  return (
    <section className="mx-auto max-w-7xl px-4 py-14">
      <SectionHeader title="Best Sellers" cta={{ label: "View All", to: "/collections/best-sellers" }} />
      <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-5">
        {bestSellers.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
