import { Link } from "react-router-dom";
import { ArrowRightIcon } from "../ui/Icons";

export default function CollectionSpotlight() {
  return (
    <section className="bg-cream">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 lg:grid-cols-2">
        <div className="order-2 max-w-md lg:order-1 lg:justify-self-center">
          <p className="label-caps mb-4 text-navy-400">New Collection</p>
          <h2 className="font-display text-4xl text-navy lg:text-5xl">Maya Collection</h2>
          <p className="mt-5 text-[15px] leading-relaxed tracking-wide text-navy-400">
            Luxury chiffon. Effortless elegance.
            <br />
            Crafted with Premium Fabric.
          </p>
          <Link to="/collections/maya" className="link-editorial mt-8">
            Discover Collection <ArrowRightIcon size={13} />
          </Link>
        </div>
        <div className="order-1 flex lg:order-2 lg:justify-end">
          {/* Arch-masked visual per mockup */}
          <img
            src="/products/ruwa-kaftan.jpg"
            alt="Maya Collection campaign"
            draggable={false}
            className="aspect-[4/5] w-full max-w-lg rounded-t-[999px] object-cover object-top select-none"
          />
        </div>
      </div>
    </section>
  );
}
