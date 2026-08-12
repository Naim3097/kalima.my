import Image from "next/image";
import PlaceholderImage from "./PlaceholderImage";
import { blurSeed } from "@/lib/images";
import { cn } from "@/lib/utils";

/*
  Renders photoshoot imagery when available, otherwise the branded
  placeholder gradient. All product imagery flows through here so real
  photography drops in via the catalog's `image` field alone.

  next/image handles lazy loading, responsive srcset and AVIF/WebP
  conversion. `priority` opts a specific image out of lazy loading — use it
  only for the LCP element (the first hero slide).
*/
type Props = {
  image?: string;
  tone: string;
  alt: string;
  className?: string;
  position?: string;
  /** Rendered-width hint for srcset selection. Defaults to a PLP card slot. */
  sizes?: string;
  priority?: boolean;
};

export default function ProductImage({
  image,
  tone,
  alt,
  className = "",
  position = "center top",
  sizes = "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw",
  priority = false,
}: Props) {
  if (!image) {
    return <PlaceholderImage tone={tone} className={className} label={alt} />;
  }

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <Image
        src={image}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        placeholder="blur"
        blurDataURL={blurSeed(tone)}
        draggable={false}
        className="object-cover select-none"
        style={{ objectPosition: position }}
      />
    </div>
  );
}
