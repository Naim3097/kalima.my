import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useCollection } from "../hooks/useCatalog";
import ProductCard from "../components/ui/ProductCard";

type Sort = "featured" | "price-asc" | "price-desc";

export default function CollectionPage() {
  const { slug } = useParams();
  const { data, isLoading } = useCollection(slug);
  const [sort, setSort] = useState<Sort>("featured");

  const products = useMemo(() => {
    const list = [...(data?.products ?? [])];
    if (sort === "price-asc") list.sort((a, b) => a.price - b.price);
    if (sort === "price-desc") list.sort((a, b) => b.price - a.price);
    return list;
  }, [data, sort]);

  if (isLoading) {
    return <div className="mx-auto max-w-7xl px-4 py-24 text-center text-navy-400">Loading…</div>;
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24 text-center">
        <h1 className="font-display text-3xl text-navy">Collection not found</h1>
        <Link to="/" className="link-editorial mt-6">
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-12">
      <nav className="label-caps mb-8 text-navy-300">
        <Link to="/" className="hover:text-navy transition-colors">
          Home
        </Link>{" "}
        / <span className="text-navy-400">{data.meta.title}</span>
      </nav>

      <header className="mb-10 max-w-xl">
        <h1 className="font-display text-4xl text-navy">{data.meta.title}</h1>
        <p className="mt-3 text-[14px] leading-relaxed tracking-wide text-navy-400">
          {data.meta.description}
        </p>
      </header>

      <div className="mb-8 flex items-center justify-between border-y border-navy/10 py-3">
        <p className="text-[12px] tracking-wide text-navy-400">
          {products.length} {products.length === 1 ? "piece" : "pieces"}
        </p>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="label-caps cursor-pointer bg-transparent text-navy focus:outline-none"
          aria-label="Sort products"
        >
          <option value="featured">Sort: Featured</option>
          <option value="price-asc">Price: Low to High</option>
          <option value="price-desc">Price: High to Low</option>
        </select>
      </div>

      {products.length === 0 ? (
        <p className="py-20 text-center text-navy-400">New pieces arriving soon.</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
