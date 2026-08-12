"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { HeroSlide } from "@/lib/cms";
import { blurSeed } from "@/lib/images";
import { Button } from "@/components/ui/button";

/*
  Editorial split hero — copy aligned to the site container on the left,
  photography full-bleed to the viewport edge on the right. The section
  background stays neutral cream/beige (no campaign tint) so every slide's
  studio backdrop blends cleanly; slides crossfade.

  Client Component: carousel index state + the auto-advance timer.
*/
export default function Hero({ slides }: { slides: HeroSlide[] }) {
  const [index, setIndex] = useState(0);

  // setTimeout keyed on index: any change (auto or manual dot click) restarts the 7s clock
  useEffect(() => {
    if (slides.length <= 1) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % slides.length), 7000);
    return () => clearTimeout(t);
  }, [index, slides.length]);

  if (slides.length === 0) return null;
  const slide = slides[index];

  return (
    <section
      className="relative overflow-hidden"
      style={{
        background: `
          radial-gradient(70% 110% at 82% 15%, #efe7db 0%, transparent 60%),
          #f7f3ec
        `,
      }}
    >
      <div className="grid items-stretch lg:min-h-[600px] lg:grid-cols-[1.05fr_1fr]">
        {/* Campaign image — bleeds to the right viewport edge */}
        <div className="relative order-1 h-[440px] sm:h-[520px] lg:order-2 lg:h-auto">
          {slides.map((s, i) => (
            <Image
              key={s.image}
              src={s.image}
              alt={i === index ? s.title : ""}
              fill
              sizes="100vw"
              /* First slide is the LCP element — never lazy-load it */
              priority={i === 0}
              /*
                Seeded with the section's own beige rather than the garment's
                colour. The slide is editable from the CMS, so any hardcoded
                tone would be wrong the moment someone swaps the photo — and a
                seam that matches the surrounding canvas resolves quietly,
                where a mismatched colour would flash and then correct itself.
              */
              placeholder="blur"
              blurDataURL={blurSeed("#efe7db")}
              draggable={false}
              aria-hidden={i !== index}
              className={`object-cover select-none transition-opacity duration-[1200ms] ease-in-out ${
                i === index ? "opacity-100" : "opacity-0"
              }`}
              style={{ objectPosition: s.focal ?? "center 20%" }}
            />
          ))}
          {/* Soft seams into the cream canvas */}
          <div
            className="pointer-events-none absolute inset-0 hidden lg:block"
            aria-hidden
            style={{ background: "linear-gradient(90deg, #f7f3ec 0%, rgba(247,243,236,0) 26%)" }}
          />
          <div
            className="pointer-events-none absolute inset-0 lg:hidden"
            aria-hidden
            style={{ background: "linear-gradient(0deg, #f7f3ec 0%, rgba(247,243,236,0) 16%)" }}
          />
        </div>

        {/* Copy — left edge aligns with the site container */}
        <div
          className="order-2 flex items-center px-4 py-14 lg:order-1 lg:py-24 lg:pr-16"
          style={{ paddingLeft: "max(1rem, calc((100vw - 80rem) / 2 + 1rem))" }}
        >
          <div className="max-w-xl">
            {/* Only the copy re-animates on slide change */}
            <div key={index} className="animate-hero-fade">
              <p className="label-caps mb-6 flex items-center gap-3 text-navy-400">
                <span className="h-px w-9 bg-navy-300" aria-hidden />
                {slide.eyebrow}
              </p>
              <h1 className="font-display text-4xl leading-[1.12] text-navy sm:text-5xl lg:text-[3.6rem]">
                {slide.title}
              </h1>
              <p className="mt-6 max-w-md text-[15px] leading-relaxed tracking-wide text-navy-400">
                {slide.body}
              </p>
              <div className="mt-10 flex flex-wrap gap-4">
                {slide.primary && (
                  <Button asChild variant="kalima" size="editorial">
                    <Link href={slide.primary.href}>{slide.primary.label}</Link>
                  </Button>
                )}
                {slide.secondary && (
                  <Button asChild variant="kalimaOutline" size="editorial">
                    <Link href={slide.secondary.href}>{slide.secondary.label}</Link>
                  </Button>
                )}
              </div>
            </div>

            {/* Slide navigation — stable, never over the photo. A lone slide
                needs no dots and no "01 / 01". */}
            {slides.length > 1 && (
              <div className="mt-14 flex items-center gap-5">
                <div className="flex gap-2.5">
                  {slides.map((_, i) => (
                    <button
                      key={i}
                      aria-label={`Slide ${i + 1}`}
                      onClick={() => setIndex(i)}
                      className={`h-1 rounded-full transition-all duration-300 cursor-pointer ${
                        i === index ? "w-8 bg-navy" : "w-4 bg-navy/20 hover:bg-navy/40"
                      }`}
                    />
                  ))}
                </div>
                <span className="text-[11px] tracking-[0.25em] text-navy-300">
                  0{index + 1} / 0{slides.length}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
