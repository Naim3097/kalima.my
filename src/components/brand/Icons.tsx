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

/* ---- Social ------------------------------------------------------------- */

/*
  Platform marks. These break the outline house style on purpose: a brand mark
  is recognised by its exact shape, and redrawing it in a 1.25px stroke to
  match the set makes it read as "some icon" rather than as Instagram. They
  fill with currentColor, so they still take the surrounding text colour.
*/
function solid({ size = 18, ...props }: P) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "currentColor",
    ...props,
  };
}

export const InstagramIcon = (p: P) => (
  <svg {...solid(p)}>
    <path d="M12 2c2.72 0 3.06.01 4.12.06 1.07.05 1.8.22 2.43.46.66.26 1.22.6 1.77 1.16.56.55.9 1.11 1.16 1.77.24.63.41 1.36.46 2.43.05 1.06.06 1.4.06 4.12s-.01 3.06-.06 4.12c-.05 1.07-.22 1.8-.46 2.43a4.9 4.9 0 0 1-1.16 1.77c-.55.56-1.11.9-1.77 1.16-.63.24-1.36.41-2.43.46-1.06.05-1.4.06-4.12.06s-3.06-.01-4.12-.06c-1.07-.05-1.8-.22-2.43-.46a4.9 4.9 0 0 1-1.77-1.16 4.9 4.9 0 0 1-1.16-1.77c-.24-.63-.41-1.36-.46-2.43C2.01 15.06 2 14.72 2 12s.01-3.06.06-4.12c.05-1.07.22-1.8.46-2.43.26-.66.6-1.22 1.16-1.77.55-.56 1.11-.9 1.77-1.16.63-.24 1.36-.41 2.43-.46C8.94 2.01 9.28 2 12 2Zm0 1.8c-2.67 0-2.99.01-4.04.06-.98.04-1.5.2-1.86.34-.47.18-.8.4-1.15.75-.35.35-.57.68-.75 1.15-.14.36-.3.88-.34 1.86-.05 1.05-.06 1.37-.06 4.04s.01 2.99.06 4.04c.04.98.2 1.5.34 1.86.18.47.4.8.75 1.15.35.35.68.57 1.15.75.36.14.88.3 1.86.34 1.05.05 1.37.06 4.04.06s2.99-.01 4.04-.06c.98-.04 1.5-.2 1.86-.34.47-.18.8-.4 1.15-.75.35-.35.57-.68.75-1.15.14-.36.3-.88.34-1.86.05-1.05.06-1.37.06-4.04s-.01-2.99-.06-4.04c-.04-.98-.2-1.5-.34-1.86a3.1 3.1 0 0 0-.75-1.15 3.1 3.1 0 0 0-1.15-.75c-.36-.14-.88-.3-1.86-.34-1.05-.05-1.37-.06-4.04-.06Zm0 3.07a5.13 5.13 0 1 1 0 10.26 5.13 5.13 0 0 1 0-10.26Zm0 1.8a3.33 3.33 0 1 0 0 6.66 3.33 3.33 0 0 0 0-6.66Zm5.34-3.2a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Z" />
  </svg>
);

export const TikTokIcon = (p: P) => (
  <svg {...solid(p)}>
    <path d="M16.6 2h-3.1v13.2a2.6 2.6 0 1 1-2.2-2.57V9.5a5.7 5.7 0 1 0 5.3 5.68V8.9a6.6 6.6 0 0 0 3.9 1.26V7.05a3.7 3.7 0 0 1-2.75-1.36A3.75 3.75 0 0 1 16.6 2.9V2Z" />
  </svg>
);

export const FacebookIcon = (p: P) => (
  <svg {...solid(p)}>
    <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.52 1.49-3.91 3.77-3.91 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.89h2.78l-.45 2.91h-2.33V22c4.78-.76 8.44-4.92 8.44-9.94Z" />
  </svg>
);

/* Threads. Hand-simplifying this one produced a squiggle nobody recognised at
   20px, so it is the real glyph outline. */
export const ThreadsIcon = (p: P) => (
  <svg {...solid(p)}>
    <path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.885-2.359-.892h-.029c-.844 0-1.992.232-2.721 1.32L7.734 7.847c.98-1.454 2.568-2.256 4.478-2.256h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.216.094.321.142 1.49.7 2.58 1.761 3.154 3.07.797 1.82.871 4.79-1.548 7.158-1.85 1.81-4.094 2.628-7.277 2.65Zm1.003-11.69c-.242 0-.487.007-.739.021-1.836.103-2.98.946-2.916 2.143.067 1.256 1.452 1.839 2.784 1.767 1.224-.065 2.818-.543 3.086-3.71a10.5 10.5 0 0 0-2.215-.221Z" />
  </svg>
);
