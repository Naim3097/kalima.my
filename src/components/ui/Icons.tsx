import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...props }: P) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.25,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
}

export const SearchIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const PinIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11Z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
);

export const UserIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
  </svg>
);

export const HeartIcon = ({ filled, ...p }: P & { filled?: boolean }) => (
  <svg {...base(p)} fill={filled ? "currentColor" : "none"}>
    <path d="M12 20.5S4 15.5 4 9.8C4 7 6.2 5 8.8 5c1.4 0 2.6.7 3.2 1.7C12.6 5.7 13.8 5 15.2 5 17.8 5 20 7 20 9.8c0 5.7-8 10.7-8 10.7Z" />
  </svg>
);

export const BagIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 8h14l-1 13H6L5 8Z" />
    <path d="M9 10V6a3 3 0 0 1 6 0v4" />
  </svg>
);

export const ChevronDownIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const ChevronLeftIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m15 6-6 6 6 6" />
  </svg>
);

export const ChevronRightIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const ArrowRightIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 12h16" />
    <path d="m14 6 6 6-6 6" />
  </svg>
);

export const CloseIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);

export const MenuIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

export const MinusIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 12h14" />
  </svg>
);

export const PlusIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const TruckIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7" />
    <circle cx="7" cy="17.5" r="1.6" />
    <circle cx="17" cy="17.5" r="1.6" />
  </svg>
);

export const ReturnIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 5 5 9l4 4" />
    <path d="M5 9h9a5 5 0 0 1 0 10H8" />
  </svg>
);

export const ShieldIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3 5 6v5c0 5 3.2 8.4 7 10 3.8-1.6 7-5 7-10V6l-7-3Z" />
    <path d="m9 11.5 2 2 4-4.5" />
  </svg>
);

export const HeadsetIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 13a8 8 0 0 1 16 0" />
    <rect x="3" y="13" width="4" height="6" rx="1.5" />
    <rect x="17" y="13" width="4" height="6" rx="1.5" />
    <path d="M19 19a3 3 0 0 1-3 2h-3" />
  </svg>
);

export const LeafIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 18C6 10 12 5 20 4c0 8-4 14-12 14" />
    <path d="M4 20c2-4 5-7 9-9" />
  </svg>
);

export const FlagIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 21V4" />
    <path d="M6 5c4-2 8 2 12 0v8c-4 2-8-2-12 0" />
  </svg>
);

export const FabricIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 6c0-1.1.9-2 2-2h12a2 2 0 0 1 2 2v2H8a2 2 0 0 0-2 2v10a2 2 0 0 1-2-2V6Z" />
    <path d="M8 8h12v10a2 2 0 0 1-2 2H8V8Z" />
  </svg>
);

export const ScissorsIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="6" cy="7" r="2.5" />
    <circle cx="6" cy="17" r="2.5" />
    <path d="M8.2 8.5 20 19M20 5 8.2 15.5" />
  </svg>
);

export const SizesIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 17 17 3l4 4L7 21l-4-4Z" />
    <path d="m8 12 1.5 1.5M11 9l1.5 1.5M14 6l1.5 1.5" />
  </svg>
);
