import Image from "next/image";
import Link from "next/link";
import { ArrowRightIcon } from "@/components/brand/Icons";
import { blurSeed, productPhoto } from "@/lib/images";

/* Server Component — editorial band, purely presentational. */
export default function CollectionSpotlight() {
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
              src={productPhoto("serra-scallop", "burgundy")}
              alt="Serra Scallop cardigan abaya in burgundy"
              placeholder="blur"
              blurDataURL={blurSeed("#631934")}
              fill
              sizes="(max-width: 1024px) 100vw, 32rem"
              draggable={false}
              className="object-cover object-top select-none"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
