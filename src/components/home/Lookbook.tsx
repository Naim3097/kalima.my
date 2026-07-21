import Image from "next/image";
import Link from "next/link";
import SectionHeader from "@/components/brand/SectionHeader";

const SHOTS = [
  { image: "/products/maya-chiffon.jpg", href: "/products/maya-chiffon" },
  { image: "/products/bella-dress.jpg", href: "/products/bella-dress" },
  { image: "/products/amanda-sparkle.jpg", href: "/products/amanda-sparkle" },
  { image: "/products/ruwa-kaftan-blue.jpg", href: "/products/ruwa-kaftan" },
  { image: "/products/sofea-dress.jpg", href: "/products/sofea-dress" },
];

/* Server Component — a static grid of links; no wishlist or state here. */
export default function Lookbook() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-14">
      <SectionHeader title="Lookbook" cta={{ label: "View Instagram", href: "/pages/contact" }} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {SHOTS.map((shot) => (
          <Link key={shot.image} href={shot.href} className="group block overflow-hidden">
            <div className="relative aspect-[4/5] w-full overflow-hidden">
              <Image
                src={shot.image}
                alt="Kalima lookbook"
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
