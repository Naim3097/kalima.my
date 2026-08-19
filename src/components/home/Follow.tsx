import SocialLinks from "@/components/brand/SocialLinks";
import type { SocialLink } from "@/lib/cms";

/*
  Server Component — the follow strip, sitting between the Instagram strip and
  the newsletter so the two "keep in touch" asks are next to each other rather
  than scattered.

  Renders nothing at all when no profile has been set in Settings. An empty
  heading over an empty row would read as broken; absent reads as deliberate.
*/
export default function Follow({ links }: { links: SocialLink[] }) {
  if (!links.length) return null;

  return (
    <section className="bg-cream">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-5 px-4 py-14 text-center">
        <p className="label-caps text-navy-400">Follow Kalima</p>
        <h2 className="font-display text-3xl text-navy">Join us on social</h2>
        <p className="max-w-md text-[13px] leading-relaxed tracking-wide text-navy-400">
          New drops, styling notes and behind-the-scenes from the atelier.
        </p>
        <SocialLinks
          links={links}
          size={22}
          className="mt-1 justify-center gap-4"
          itemClassName="size-12 border-navy/20 text-navy hover:border-navy hover:bg-navy hover:text-white"
        />
      </div>
    </section>
  );
}
