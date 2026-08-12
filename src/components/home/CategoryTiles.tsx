import Link from "next/link";
import { ArrowRightIcon } from "@/components/brand/Icons";
import ProductImage from "@/components/brand/ProductImage";
import { productPhoto } from "@/lib/images";

/* tone is the ground shown while the photo loads — taken from each shot. */
const TILES = [
  { label: "Women", href: "/collections/women", tone: "#7b6050", image: productPhoto("ruwa-caftan", "mocha") },
  { label: "Men", href: "/collections/men", tone: "#2b3342", image: productPhoto("kurta-zaid", "navy") },
  { label: "Accessories", href: "/collections/accessories", tone: "#b08f81", image: productPhoto("italian-chiffon-shawl", "latte") },
];

/* Server Component — static tiles, no state or handlers. */
export default function CategoryTiles() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-14">
      <div className="grid gap-5 md:grid-cols-3">
        {TILES.map((tile) => (
          <Link key={tile.label} href={tile.href} className="group relative block overflow-hidden">
            <ProductImage
              image={tile.image}
              tone={tile.tone}
              alt={tile.label}
              className="aspect-[4/3] w-full transition-transform duration-700 group-hover:scale-[1.03]"
              position="center 20%"
              sizes="(max-width: 768px) 100vw, 33vw"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-navy-900/50 via-transparent to-transparent" />
            <div className="absolute bottom-6 left-6 text-white">
              <p className="font-display text-3xl">{tile.label}</p>
              <p className="label-caps mt-2 inline-flex items-center gap-2 text-white/80 transition-colors group-hover:text-white">
                Explore Now <ArrowRightIcon size={13} />
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
