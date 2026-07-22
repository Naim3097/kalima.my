import type { Metadata } from "next";
import Link from "next/link";
import { ProductForm } from "@/components/admin/ProductForm";

export const metadata: Metadata = {
  title: "New product · Admin",
  description: "Create a new Kalima product.",
};

export default function NewProductPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/products" className="label-caps text-[11px] text-navy-400 hover:text-navy">
          ← Products
        </Link>
        <h1 className="mt-2 font-display text-3xl text-navy">New product</h1>
        <p className="mt-1 text-[13px] tracking-wide text-navy-400">
          Save the product first, then add colour / size variants and stock.
        </p>
      </div>

      <ProductForm />
    </div>
  );
}
