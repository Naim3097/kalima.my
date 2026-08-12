import Image from "next/image";
import Link from "next/link";
import SectionHeader from "@/components/brand/SectionHeader";
import { blurSeed, productPhoto } from "@/lib/images";

/* One shot per piece, chosen for contrast across the row. */
const SHOTS = [
  { tone: "#8d2d33", slug: "ruwa-caftan", colour: "burgundy", alt: "Ruwa Caftan in burgundy satin" },
  { tone: "#be1a84", slug: "danisya-set", colour: "magenta", alt: "Danisya Set in magenta satin" },
  { tone: "#126c82", slug: "serra-scallop", colour: "teal-green", alt: "Serra Scallop cardigan abaya in teal green" },
  { tone: "#7a9c86", slug: "anna-top", colour: "peony-garden", alt: "Anna Top in the Peony Garden print" },
  { tone: "#c8bcb0", slug: "luna-palazzo", colour: "sand", alt: "Luna Palazo in sand" },
];

/* Server Component — a static grid of links; no wishlist or state here. */
export default function Lookbook() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-14">
      <SectionHeader title="Lookbook" cta={{ label: "View Instagram", href: "/pages/contact" }} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {SHOTS.map((shot) => (
          <Link key={shot.slug} href={`/products/${shot.slug}`} className="group block overflow-hidden">
            <div className="relative aspect-[4/5] w-full overflow-hidden">
              <Image
                src={productPhoto(shot.slug, shot.colour)}
                alt={shot.alt}
                placeholder="blur"
                blurDataURL={blurSeed(shot.tone)}
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                draggable={false}
                className="object-cover object-top transition-transform duration-500 group-hover:scale-[1.03] select-none"
              />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
