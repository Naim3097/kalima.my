"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { PlayIcon } from "@/components/brand/Icons";
import SectionHeader from "@/components/brand/SectionHeader";
import { blurSeed } from "@/lib/images";
import type { InstagramPost, LookbookShot } from "@/lib/cms";

/*
  The homepage Lookbook — the shop's Instagram feed as a swipeable carousel.

  TWO SOURCES, one strip. Instagram posts when the daily sync has any (see
  src/lib/instagram/sync.ts); otherwise the curated `lookbook_shots`, which is
  what an unconnected shop, a failed sync and a fresh clone all fall back to. The
  section never disappears and never renders a hole.

  Where a tile GOES depends on what we know about it. A curated shot is a product
  shot, so it links to the product. An Instagram post links to the product only
  when staff have tagged it; untagged, it opens the post on Instagram. The point
  of the tagging is that this section keeps pulling people into the catalogue
  instead of sending all of them to another app.

  Client Component for the carousel's scroll state — the arrows have to know
  whether there is anything left to scroll to. The scrolling itself is native
  (scroll-snap), so touch swiping, trackpads, keyboards and reduced-motion all
  behave the way the platform already makes them behave, and the tiles are real
  links whether or not the JS arrives.
*/

type Tile = {
  key: string;
  image: string;
  alt: string;
  tone: string;
  href: string;
  /* Instagram opens off-site; a product page does not. */
  external: boolean;
  /* A reel's tile is one frame of it — say so, or it reads as a photo. */
  video: boolean;
};

/* The neutral ground behind a loading tile. Instagram photography is not ours
   to pick a tone from, and the strip sits on cream. */
const TILE_TONE = "#efe7db";

function tilesFrom(posts: InstagramPost[], shots: LookbookShot[]): Tile[] {
  if (posts.length > 0) {
    return posts.map((post) => ({
      key: post.id,
      image: post.image,
      alt: post.alt,
      tone: TILE_TONE,
      href: post.slug ? `/products/${post.slug}` : post.permalink,
      external: !post.slug,
      video: post.video,
    }));
  }

  return shots.map((shot) => ({
    key: `${shot.slug}-${shot.image}`,
    image: shot.image,
    alt: shot.alt,
    tone: shot.tone,
    href: `/products/${shot.slug}`,
    external: false,
    video: false,
  }));
}

export default function Lookbook({
  posts = [],
  shots,
  instagramHref,
}: {
  posts?: InstagramPost[];
  shots: LookbookShot[];
  instagramHref?: string | null;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const tiles = tilesFrom(posts, shots);

  /*
    Which arrows are live. Read off the rail rather than tracked as an index:
    the rail is scrolled by fingers and trackpads too, and an index would
    describe only the scrolling this component did itself.
  */
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const measure = () => {
      const max = rail.scrollWidth - rail.clientWidth;
      setAtStart(rail.scrollLeft <= 1);
      // Sub-pixel widths mean scrollLeft never quite reaches max.
      setAtEnd(rail.scrollLeft >= max - 1);
    };

    measure();
    rail.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      rail.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [tiles.length]);

  /* Nothing to show → render nothing, rather than a heading over an empty rail. */
  if (tiles.length === 0) return null;

  /* Scroll by a viewport of the rail, less one tile, so nothing is skipped past. */
  function nudge(direction: 1 | -1) {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({ left: direction * Math.max(rail.clientWidth * 0.8, 240), behavior: "smooth" });
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-14">
      <SectionHeader
        title="Lookbook"
        cta={{ label: "View Instagram", href: instagramHref || "/pages/contact" }}
      />

      <div className="relative">
        <div
          ref={railRef}
          /* no-scrollbar matches the mobile nav rail in the admin shell. */
          className="no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth"
        >
          {tiles.map((tile) => {
            const inner = (
              <div className="relative aspect-[4/5] w-full overflow-hidden">
                <Image
                  src={tile.image}
                  alt={tile.alt}
                  placeholder="blur"
                  blurDataURL={blurSeed(tile.tone)}
                  fill
                  sizes="(max-width: 640px) 60vw, (max-width: 1024px) 33vw, 20vw"
                  draggable={false}
                  className="object-cover object-top transition-transform duration-500 group-hover:scale-[1.03] select-none"
                />

                {/*
                  Reel marker. Top-right, where Instagram itself puts it, so it
                  is read without being learned. A drop-shadow rather than a
                  filled chip: the tile is photography, and a solid badge in the
                  corner of every other frame is a lot of furniture for one bit
                  of information.

                  aria-hidden — the caption already carries the meaning to a
                  screen reader, and "play" is not what this tile does anyway
                  (it opens the post, it does not start a video).
                */}
                {tile.video && (
                  <PlayIcon
                    size={22}
                    aria-hidden
                    className="absolute right-2.5 top-2.5 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.55)]"
                  />
                )}
              </div>
            );

            const className =
              "group block w-[60vw] shrink-0 snap-start overflow-hidden sm:w-[38vw] lg:w-[calc((100%-4rem)/5)]";

            /*
              An Instagram permalink is off-site, so it is a plain anchor with
              noopener — next/link would prefetch a domain it cannot route to.
            */
            return tile.external ? (
              <a
                key={tile.key}
                href={tile.href}
                target="_blank"
                rel="noopener noreferrer"
                className={className}
              >
                {inner}
              </a>
            ) : (
              <Link key={tile.key} href={tile.href} className={className}>
                {inner}
              </Link>
            );
          })}
        </div>

        {/*
          Desktop affordance only, and hidden entirely when the rail does not
          overflow. Touch users swipe; a disabled arrow on a strip that fits is
          furniture. aria-hidden because the links themselves are already in the
          tab order — these move a scroll box, they are not navigation.
        */}
        {!(atStart && atEnd) && (
          <div className="pointer-events-none absolute inset-y-0 left-0 right-0 hidden items-center justify-between lg:flex">
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              onClick={() => nudge(-1)}
              disabled={atStart}
              className="pointer-events-auto -ml-5 flex size-10 cursor-pointer items-center justify-center rounded-full bg-white/90 text-navy shadow-sm transition-opacity disabled:pointer-events-none disabled:opacity-0"
            >
              ←
            </button>
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              onClick={() => nudge(1)}
              disabled={atEnd}
              className="pointer-events-auto -mr-5 flex size-10 cursor-pointer items-center justify-center rounded-full bg-white/90 text-navy shadow-sm transition-opacity disabled:pointer-events-none disabled:opacity-0"
            >
              →
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
