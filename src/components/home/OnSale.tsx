import { discountPercent, type Product } from "@/data/catalog";
import ProductCard from "@/components/brand/ProductCard";
import SectionHeader from "@/components/brand/SectionHeader";

/*
  The homepage "On Sale" row.

  IT NOW SHOWS THINGS THAT ARE ACTUALLY ON SALE. This was BestSellers.tsx: it
  filtered `bestSeller` under an "On Sale" heading, with a comment explaining
  that the catalogue carried no discount prices yet. That was fair at the time
  and stopped being true when sale prices shipped — the row was showing
  full-price pieces to shoppers who had just read the word SALE, with no badge
  and no struck-through price to explain why.

  Filtering on salePrice means the heading cannot drift from the contents again:
  a piece appears here because it is discounted, and leaves when it is not.
  Nobody has to remember to update a flag.

  Ordered by DEEPEST DISCOUNT first, because that is what the row is selling and
  what the badge on each card announces. Best sellers keep their own smart
  collection at /collections/best-sellers; they simply no longer masquerade as a
  sale.

  Server Component — the page fetches the catalogue and passes it down; only the
  ProductCard children are client-side (wishlist + colour swatches).
*/
export default function OnSale({ products }: { products: Product[] }) {
  const onSale = products
    .filter((p) => p.salePrice != null)
    .sort((a, b) => discountPercent(b) - discountPercent(a))
    .slice(0, 5);

  /*
    Nothing discounted → render nothing. An empty "On Sale" heading is worse
    than no section: it reads as a broken page rather than an honest absence,
    and this row is entirely promotional.
  */
  if (onSale.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-14">
      <SectionHeader title="On Sale" cta={{ label: "View All", href: "/collections/sale" }} />
      <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-5">
        {onSale.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
