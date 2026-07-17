import { USPS } from "../../data/catalog";
import { FlagIcon, FabricIcon, ScissorsIcon, SizesIcon, LeafIcon } from "../ui/Icons";

const ICONS = {
  flag: FlagIcon,
  fabric: FabricIcon,
  scissors: ScissorsIcon,
  sizes: SizesIcon,
  leaf: LeafIcon,
} as const;

export default function UspStrip() {
  return (
    <section className="bg-beige">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-x-6 gap-y-10 px-4 py-12 md:grid-cols-3 lg:grid-cols-5">
        {USPS.map((usp) => {
          const Icon = ICONS[usp.icon];
          return (
            <div key={usp.title} className="text-center">
              <Icon size={30} className="mx-auto text-navy" />
              <p className="mt-4 text-[13px] font-medium tracking-wide text-navy">{usp.title}</p>
              <p className="mx-auto mt-1.5 max-w-[180px] text-[12px] leading-relaxed tracking-wide text-navy-400">
                {usp.body}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
