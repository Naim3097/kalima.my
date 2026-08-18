import Image from "next/image";
import Link from "next/link";
import { ArrowRightIcon } from "@/components/brand/Icons";
import { getEditorialImages } from "@/lib/editorial";
import { blurSeed, framingStyle } from "@/lib/images";

/*
  Server Component — editorial band. The copy and the link are layout; the
  photograph and its framing come from the CMS `spotlight` slot, falling back
  to the hand-picked shot when nobody has changed it.
*/
export default async function CollectionSpotlight() {
  const shot = (await getEditorialImages()).spotlight;

  return (
    <section className="bg-cream">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 lg:grid-cols-2">
        <div className="order-2 max-w-md lg:order-1 lg:justify-self-center">
          <p className="label-caps mb-4 text-navy-400">The Statement Piece</p>
          <h2 className="font-display text-4xl text-navy lg:text-5xl">Serra Scallop</h2>
          <p className="mt-5 text-[15px] leading-relaxed tracking-wide text-navy-400">
            Scalloped embroidery over premium satin.
            <br />
            A cardigan abaya in two layers.
          </p>
          <Link href="/products/serra-scallop" className="link-editorial mt-8">
            Discover the piece <ArrowRightIcon size={13} />
          </Link>
        </div>
        <div className="order-1 flex lg:order-2 lg:justify-end">
          {/* Arch-masked visual per mockup */}
          <div className="relative aspect-[4/5] w-full max-w-lg overflow-hidden rounded-t-[999px]">
            <Image
              src={shot.image}
              alt={shot.alt}
              placeholder="blur"
              /*
                Seeded with the band's own cream, not the garment's burgundy:
                the shot is editable now, so a tone tied to one photograph is
                wrong the moment it is replaced.
              */
              blurDataURL={blurSeed("#f7f3ec")}
              fill
              sizes="(max-width: 1024px) 100vw, 32rem"
              draggable={false}
              className="object-cover select-none"
              style={framingStyle(shot)}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
