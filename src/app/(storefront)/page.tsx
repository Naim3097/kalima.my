import type { Metadata } from "next";
import { fetchProducts } from "@/data/catalog.queries";
import { getHeroSlides, getSocialLinks } from "@/lib/cms";
import Hero from "@/components/home/Hero";
import CategoryTiles from "@/components/home/CategoryTiles";
import CollectionSpotlight from "@/components/home/CollectionSpotlight";
import BestSellers from "@/components/home/BestSellers";
import UspStrip from "@/components/home/UspStrip";
import Lookbook from "@/components/home/Lookbook";
import Follow from "@/components/home/Follow";
import Newsletter from "@/components/home/Newsletter";

export const metadata: Metadata = {
  title: "Timeless Modest Luxury",
  description:
    "Modest luxury designed in Malaysia for every beautiful journey. Premium fabrics, in-house design, inclusive sizing.",
};

/*
  Home. Server Component — the catalogue is fetched here once and handed to
  BestSellers, so no section below needs its own data boundary. Only Hero
  (carousel) and Newsletter (email form) ship client JS.
*/
export const revalidate = 3600;

export default async function HomePage() {
  const [products, heroSlides, socialLinks] = await Promise.all([
    fetchProducts(),
    getHeroSlides(),
    getSocialLinks(),
  ]);

  return (
    <>
      <Hero slides={heroSlides} />
      <CategoryTiles />
      <CollectionSpotlight />
      <BestSellers products={products} />
      <UspStrip />
      <Lookbook />
      <Follow links={socialLinks} />
      <Newsletter />
    </>
  );
}
