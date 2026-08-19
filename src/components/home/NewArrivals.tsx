import type { Product } from "@/data/catalog";
import ProductCard from "@/components/brand/ProductCard";
import SectionHeader from "@/components/brand/SectionHeader";

/*
  The homepage "New Arrivals" row — the first product row a visitor meets.

  Sits above On Sale deliberately: what is new is the reason to come back, and a
  shopper who lands on discounts first reads the shop as a sale rack. The two
  rows draw from disjoint intents, not disjoint sets — a piece can be both new
  and discounted, and appearing twice is correct when it is.

  FILTERS ON THE SAME FLAG THE COLLECTION DOES. `newArrival` is what
  /collections/new-arrivals selects on, so the row and the page behind its
  "View All" can never disagree — which is the failure the On Sale row was
  rebuilt to escape, when it filtered `bestSeller` under a SALE heading.

  Newest first, by the date the piece was added. "New" with an arbitrary order
  inside it invites the question of what makes the first tile first.

  Server Component — the page fetches the catalogue once and passes it down;
  only the ProductCard children are client-side (wishlist + colour swatches).
*/
export default function NewArrivals({ products }: { products: Product[] }) {
  const arrivals = products
    .filter((p) => p.newArrival)
    /* createdAt descending. Missing dates sort last rather than throwing the
       order — an undated piece is not evidence that it is the newest. */
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 5);

  /*
    Nothing new → render nothing. An empty "New Arrivals" heading reads as a
    broken page rather than an honest absence, exactly as it does for On Sale.
  */
  if (arrivals.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-14">
      <SectionHeader title="New Arrivals" cta={{ label: "View All", href: "/collections/new-arrivals" }} />
      <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-5">
        {arrivals.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
