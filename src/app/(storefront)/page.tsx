import type { Metadata } from "next";
import { fetchProducts } from "@/data/catalog.queries";
import { getHeroSlides, getInstagramPosts, getSocialLinks } from "@/lib/cms";
import Hero from "@/components/home/Hero";
import CategoryTiles from "@/components/home/CategoryTiles";
import CollectionSpotlight from "@/components/home/CollectionSpotlight";
import NewArrivals from "@/components/home/NewArrivals";
import OnSale from "@/components/home/OnSale";
import UspStrip from "@/components/home/UspStrip";
import InstagramStrip from "@/components/home/InstagramStrip";
import Follow from "@/components/home/Follow";
import Newsletter from "@/components/home/Newsletter";

export const metadata: Metadata = {
  title: "Timeless Modest Luxury",
  description:
    "Modest luxury designed in Malaysia for every beautiful journey. Premium fabrics, in-house design, inclusive sizing.",
};

/*
  Home. Server Component — the catalogue is fetched here once and handed to both
  product rows, so no section below needs its own data boundary. Only Hero
  (carousel), the Instagram strip (scroll state) and Newsletter (email form)
  ship client JS.

  THE ORDER IS THE ARGUMENT THE PAGE MAKES. What is new comes before what is
  discounted: a shopper who meets the sale rack first reads the shop as a sale
  rack. The spotlight then slows the page down after two dense grids, the trust
  strip answers the doubts that follow a decision, and Instagram sits last
  because it is the one section whose links leave the site.
*/
export const revalidate = 3600;

export default async function HomePage() {
  const [products, heroSlides, socialLinks, instagramPosts] = await Promise.all([
    fetchProducts(),
    getHeroSlides(),
    getSocialLinks(),
    getInstagramPosts(),
  ]);

  /* The strip's CTA says "View Instagram", so point it at Instagram when the
     shop has one configured. Falls back to the contact page. */
  const instagramHref = socialLinks.find((l) => l.platform === "instagram")?.href ?? null;

  return (
    <>
      <Hero slides={heroSlides} />
      <CategoryTiles />
      <NewArrivals products={products} />
      <OnSale products={products} />
      <CollectionSpotlight />
      <UspStrip />
      <InstagramStrip posts={instagramPosts} instagramHref={instagramHref} />
      <Follow links={socialLinks} />
      <Newsletter />
    </>
  );
}
