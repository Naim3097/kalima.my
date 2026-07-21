import type { Metadata } from "next";
import Link from "next/link";
import { fetchProducts } from "@/data/catalog.queries";
import WishlistGrid from "@/components/wishlist/WishlistGrid";

export const metadata: Metadata = {
  title: "Wishlist",
  description: "The Kalima pieces you've saved for later.",
};

export const revalidate = 3600;

export default async function WishlistPage() {
  // Which pieces are saved is client state; the catalog they resolve against
  // is server data, so it is fetched here and handed down.
  const products = await fetchProducts();

  return (
    <div className="mx-auto max-w-7xl px-4 py-12">
      <nav className="label-caps mb-8 text-navy-300">
        <Link href="/" className="hover:text-navy transition-colors">
          Home
        </Link>{" "}
        / <span className="text-navy-400">Wishlist</span>
      </nav>
      <h1 className="font-display text-4xl text-navy">Wishlist</h1>

      <WishlistGrid products={products} />
    </div>
  );
}
