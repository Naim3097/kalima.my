import Link from "next/link";
import { ArrowRightIcon } from "@/components/brand/Icons";
import ProductImage from "@/components/brand/ProductImage";
import { getEditorialImages, type EditorialSlot } from "@/lib/editorial";

/*
  Label, link and tone are LAYOUT and stay here; only the photograph and its
  framing come from the CMS, by slot. tone is the ground shown while the photo
  loads — a wash of the section's own cream rather than the garment's colour,
  because the photograph is now editable and any tone tied to a specific shot
  is wrong the moment someone swaps it. Same reasoning as the hero.
*/
const TILES: { label: string; href: string; slot: EditorialSlot }[] = [
  { label: "Women", href: "/collections/women", slot: "category-women" },
  { label: "Men", href: "/collections/men", slot: "category-men" },
  { label: "Accessories", href: "/collections/accessories", slot: "category-accessories" },
];

const TILE_TONE = "#efe7db";

/* Server Component — static tiles, no state or handlers. */
export default async function CategoryTiles() {
  const editorial = await getEditorialImages();

  return (
    <section className="mx-auto max-w-7xl px-4 py-14">
      <div className="grid gap-5 md:grid-cols-3">
        {TILES.map((tile) => {
          const shot = editorial[tile.slot];
          return (
            <Link key={tile.label} href={tile.href} className="group relative block overflow-hidden">
              <ProductImage
                image={shot.image}
                tone={TILE_TONE}
                alt={shot.alt || tile.label}
                className="aspect-[4/3] w-full transition-transform duration-700 group-hover:scale-[1.03]"
                position={shot.focal}
                zoom={shot.zoom}
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
          );
        })}
      </div>
    </section>
  );
}
