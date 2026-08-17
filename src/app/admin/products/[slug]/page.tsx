import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddonEditor } from "@/components/admin/AddonEditor";
import { ProductForm } from "@/components/admin/ProductForm";
import { ProductImages } from "@/components/admin/ProductImages";
import { SizeChart } from "@/components/admin/SizeChart";
import { VariantEditor } from "@/components/admin/VariantEditor";
import { getProductForEdit, listAddonCandidates } from "@/lib/admin";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductForEdit(slug);
  return { title: product ? `Edit ${product.name} · Admin` : "Product not found · Admin" };
}

export default async function EditProductPage({ params }: Params) {
  const { slug } = await params;
  const product = await getProductForEdit(slug);
  if (!product) notFound();

  const candidates = await listAddonCandidates(product.id);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <Link
            href="/admin/products"
            className="label-caps text-[11px] text-navy-400 hover:text-navy"
          >
            ← Products
          </Link>
          <h1 className="mt-2 font-display text-3xl text-navy">{product.name}</h1>
          <p className="mt-1 text-[13px] tracking-wide text-navy-400">
            Edit product details and manage variants &amp; ledger-tracked stock.
          </p>
        </div>
      </div>

      <ProductForm product={product} />
      <ProductImages
        productId={product.id}
        productSlug={product.slug}
        images={product.images}
        // Colour scoping offers exactly the colourways the variants define.
        colors={[...new Set(product.variants.map((v) => v.colorName))]}
      />
      <SizeChart
        productId={product.id}
        productSlug={product.slug}
        url={product.sizeChartUrl}
      />
      <AddonEditor
        productId={product.id}
        productSlug={product.slug}
        addons={product.addons}
        candidates={candidates}
      />
      <VariantEditor productId={product.id} productSlug={product.slug} variants={product.variants} />
    </div>
  );
}
