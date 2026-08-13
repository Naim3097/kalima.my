import type { Metadata } from "next";
import Link from "next/link";
import { CatalogTransfer } from "@/components/admin/CatalogTransfer";
import { ProductsTable } from "@/components/admin/ProductsTable";
import { Button } from "@/components/ui/button";
import { listProductsForAdmin } from "@/lib/admin";

export const metadata: Metadata = {
  title: "Products · Admin",
  description: "Kalima catalog — edit products, variants and ledger-tracked stock.",
};

/*
  Server Component. Catalog and stock come from Supabase — stock is the sum of
  stock_on_hand across the product's variants, so the "low" flag reflects real
  inventory. Each row links into the product editor, and rows can be selected
  for a bulk edit (see ProductsTable).

  Reads listProductsForAdmin rather than the storefront's fetchProducts, so
  unpublished drafts appear here — this is the only screen that can publish
  them again.
*/
export default async function AdminProductsPage() {
  const products = await listProductsForAdmin();

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl text-navy">Products</h1>
          <p className="mt-1 text-[13px] tracking-wide text-navy-400">
            One catalog — stock is ledger-tracked and adjusted with a reason for every change.
          </p>
        </div>
        <Button asChild variant="kalima" size="editorial" className="cursor-pointer px-5 py-2.5">
          <Link href="/admin/products/new">+ Add Product</Link>
        </Button>
      </div>

      <CatalogTransfer />

      <ProductsTable products={products} />
    </div>
  );
}
