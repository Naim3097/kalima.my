import Image from "next/image";
import Link from "next/link";
import SectionHeader from "@/components/brand/SectionHeader";
import { blurSeed } from "@/lib/images";
import type { LookbookShot } from "@/lib/cms";

/*
  Server Component — a static grid of links; no wishlist or state here.

  The shots arrive already resolved (see getLookbookShots in lib/cms.ts). This
  used to hold a hardcoded SHOTS array and build each URL with
  productPhoto(slug, colour), which is how it ended up advertising a colourway
  Anna Top no longer sells: the path convention still resolved to an orphaned
  storage object long after the catalogue had moved on.

  `instagramHref` is optional so an unconfigured store still renders — the CTA
  falls back to the contact page rather than linking nowhere.
*/
export default function Lookbook({
  shots,
  instagramHref,
}: {
  shots: LookbookShot[];
  instagramHref?: string | null;
}) {
  /* Nothing to show → render nothing, rather than a heading over an empty grid. */
  if (shots.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-14">
      <SectionHeader
        title="Lookbook"
        cta={{ label: "View Instagram", href: instagramHref || "/pages/contact" }}
      />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {shots.map((shot) => (
          <Link
            key={`${shot.slug}-${shot.image}`}
            href={`/products/${shot.slug}`}
            className="group block overflow-hidden"
          >
            <div className="relative aspect-[4/5] w-full overflow-hidden">
              <Image
                src={shot.image}
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
