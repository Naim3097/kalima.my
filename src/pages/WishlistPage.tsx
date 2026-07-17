import { Link } from "react-router-dom";
import { useProducts } from "../hooks/useCatalog";
import { useWishlist } from "../stores/wishlist";
import ProductCard from "../components/ui/ProductCard";
import Button from "../components/ui/Button";

export default function WishlistPage() {
  const { data: products = [] } = useProducts();
  const ids = useWishlist((s) => s.ids);
  const wished = products.filter((p) => ids.includes(p.id));

  return (
    <div className="mx-auto max-w-7xl px-4 py-12">
      <nav className="label-caps mb-8 text-navy-300">
        <Link to="/" className="hover:text-navy transition-colors">
          Home
        </Link>{" "}
        / <span className="text-navy-400">Wishlist</span>
      </nav>
      <h1 className="font-display text-4xl text-navy">Wishlist</h1>

      {wished.length === 0 ? (
        <div className="py-20 text-center">
          <p className="font-display text-xl text-navy">Nothing saved yet</p>
          <p className="mt-2 text-[14px] tracking-wide text-navy-400">
            Tap the heart on any piece to keep it here.
          </p>
          <div className="mt-8">
            <Button to="/collections/best-sellers">Shop Best Sellers</Button>
          </div>
        </div>
      ) : (
        <div className="mt-10 grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
          {wished.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
