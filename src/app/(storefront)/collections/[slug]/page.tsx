import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchCollection, listCollectionSlugs } from "@/data/catalog.queries";
import CollectionGrid from "@/components/collection/CollectionGrid";

type Props = { params: Promise<{ slug: string }> };

export const revalidate = 3600;

export async function generateStaticParams() {
  return (await listCollectionSlugs()).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchCollection(slug);
  if (!data) return { title: "Collection not found" };
  return {
    title: data.meta.title,
    description: data.meta.description,
  };
}

export default async function CollectionPage({ params }: Props) {
  const { slug } = await params;
  const data = await fetchCollection(slug);

  if (!data) notFound();

  return (
    <div className="mx-auto max-w-7xl px-4 py-12">
      <nav className="label-caps mb-8 text-navy-300">
        <Link href="/" className="hover:text-navy transition-colors">
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

      <CollectionGrid products={data.products} />
    </div>
  );
}
