import Hero from "../components/home/Hero";
import CategoryTiles from "../components/home/CategoryTiles";
import CollectionSpotlight from "../components/home/CollectionSpotlight";
import BestSellers from "../components/home/BestSellers";
import UspStrip from "../components/home/UspStrip";
import Lookbook from "../components/home/Lookbook";
import Newsletter from "../components/home/Newsletter";

export default function HomePage() {
  return (
    <>
      <Hero />
      <CategoryTiles />
      <CollectionSpotlight />
      <BestSellers />
      <UspStrip />
      <Lookbook />
      <Newsletter />
    </>
  );
}
