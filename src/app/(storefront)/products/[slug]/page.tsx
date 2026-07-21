import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  fetchProductBySlug,
  fetchProducts,
  listProductSlugs,
} from "@/data/catalog.queries";
import ProductCard from "@/components/brand/ProductCard";
import SectionHeader from "@/components/brand/SectionHeader";
import ProductDetail from "@/components/product/ProductDetail";

type Props = { params: Promise<{ slug: string }> };

/*
  Catalog now comes from Supabase, so prerendered pages would otherwise be
  frozen at build time. Revalidate hourly; Phase 3's admin CRUD should call
  revalidateTag/revalidatePath on write for instant updates.
*/
export const revalidate = 3600;

export async function generateStaticParams() {
  return (await listProductSlugs()).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await fetchProductBySlug(slug);
  if (!product) return { title: "Piece not found" };

  return {
    title: product.name,
    description: product.description,
    openGraph: {
      title: product.name,
      description: product.description,
      ...(product.image ? { images: [{ url: product.image }] } : {}),
    },
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const product = await fetchProductBySlug(slug);

  if (!product) notFound();

  const all = await fetchProducts();
  const related = all
    .filter((p) => p.id !== product.id && p.category === product.category)
    .slice(0, 4);

  return (
    <div className="mx-auto max-w-7xl px-4 py-12">
      <nav className="label-caps mb-8 text-navy-300">
        <Link href="/" className="hover:text-navy transition-colors">
          Home
        </Link>{" "}
        /{" "}
        <Link
          href={`/collections/${product.category}`}
          className="hover:text-navy transition-colors capitalize"
        >
          {product.category}
        </Link>{" "}
        / <span className="text-navy-400">{product.name}</span>
      </nav>

      <ProductDetail product={product} />

      {related.length > 0 && (
        <div className="mt-20">
          <SectionHeader
            title="You may also like"
            cta={{ label: "View All", href: `/collections/${product.category}` }}
          />
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 lg:grid-cols-4">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
