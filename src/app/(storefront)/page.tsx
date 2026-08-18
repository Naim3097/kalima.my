import type { Metadata } from "next";
import { fetchProducts } from "@/data/catalog.queries";
import { getHeroSlides, getInstagramPosts, getLookbookShots, getSocialLinks } from "@/lib/cms";
import Hero from "@/components/home/Hero";
import CategoryTiles from "@/components/home/CategoryTiles";
import CollectionSpotlight from "@/components/home/CollectionSpotlight";
import OnSale from "@/components/home/OnSale";
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
  OnSale, so no section below needs its own data boundary. Only Hero
  (carousel) and Newsletter (email form) ship client JS.
*/
export const revalidate = 3600;

export default async function HomePage() {
  const [products, heroSlides, socialLinks, lookbook, instagramPosts] = await Promise.all([
    fetchProducts(),
    getHeroSlides(),
    getSocialLinks(),
    /* Both, always: the Lookbook shows Instagram when the sync has posts and
       the curated shots when it does not, and which one that is cannot be known
       without asking. Two cached reads, one round trip each. */
    getLookbookShots(),
    getInstagramPosts(),
  ]);

  /* The Lookbook CTA says "View Instagram", so point it at Instagram when the
     shop has one configured. Falls back to the contact page. */
  const instagramHref = socialLinks.find((l) => l.platform === "instagram")?.href ?? null;

  return (
    <>
      <Hero slides={heroSlides} />
      <CategoryTiles />
      <CollectionSpotlight />
      <OnSale products={products} />
      <UspStrip />
      <Lookbook posts={instagramPosts} shots={lookbook} instagramHref={instagramHref} />
      <Follow links={socialLinks} />
      <Newsletter />
    </>
  );
}
