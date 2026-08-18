import {
  FabricIcon,
  FlagIcon,
  HeadsetIcon,
  HeartIcon,
  LeafIcon,
  ReturnIcon,
  ShieldIcon,
  TruckIcon,
} from "@/components/brand/Icons";

/*
  The icons a footer trust item may use, by KEY.

  Its own module because both sides need it: the storefront footer (a Server
  Component) renders the icon, and the admin editor (a Client Component) offers
  the list to pick from. Keeping it in src/lib/footer.ts would drag that file's
  Supabase server client — and its `server-only` guard — into the browser
  bundle, which is a build error rather than a subtle one. Only the build finds
  it, so the split is deliberate: no data access belongs in this file.

  An editor picks a name; nothing it types becomes markup on the page, and a key
  that no longer exists falls back rather than rendering a hole.
*/
export const TRUST_ICONS = {
  truck: TruckIcon,
  return: ReturnIcon,
  shield: ShieldIcon,
  headset: HeadsetIcon,
  leaf: LeafIcon,
  flag: FlagIcon,
  fabric: FabricIcon,
  heart: HeartIcon,
} as const;

export type TrustIconKey = keyof typeof TRUST_ICONS;

export const TRUST_ICON_KEYS = Object.keys(TRUST_ICONS) as TrustIconKey[];

export const trustIcon = (key: string) =>
  TRUST_ICONS[key as TrustIconKey] ?? TRUST_ICONS.truck;
