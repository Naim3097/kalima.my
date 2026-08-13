import type { SocialLink } from "@/lib/cms";
import {
  FacebookIcon,
  InstagramIcon,
  ThreadsIcon,
  TikTokIcon,
} from "@/components/brand/Icons";

const META: Record<SocialLink["platform"], { label: string; Icon: typeof InstagramIcon }> = {
  instagram: { label: "Instagram", Icon: InstagramIcon },
  tiktok: { label: "TikTok", Icon: TikTokIcon },
  facebook: { label: "Facebook", Icon: FacebookIcon },
  threads: { label: "Threads", Icon: ThreadsIcon },
};

/*
  The social row. Server-renderable and colour-agnostic: the icons fill with
  currentColor, so the same component works on cream and on the navy footer by
  inheriting the surrounding text colour.

  Every link is rel="noopener noreferrer" — these are the only outbound links
  on the site that open a new tab, and target="_blank" without noopener hands
  the opened page a live reference back to ours.
*/
export default function SocialLinks({
  links,
  size = 20,
  className = "",
  itemClassName = "",
}: {
  links: SocialLink[];
  size?: number;
  className?: string;
  itemClassName?: string;
}) {
  if (!links.length) return null;

  return (
    <ul className={`flex items-center gap-3 ${className}`}>
      {links.map(({ platform, href }) => {
        const { label, Icon } = META[platform];
        return (
          <li key={platform}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Kalima on ${label}`}
              title={label}
              className={`flex size-10 items-center justify-center rounded-full border transition-colors ${itemClassName}`}
            >
              <Icon size={size} />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
