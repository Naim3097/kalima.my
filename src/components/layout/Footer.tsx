import Link from "next/link";
import StaffLink from "@/components/layout/StaffLink";
import Image from "next/image";
import SocialLinks from "@/components/brand/SocialLinks";
import { getSocialLinks } from "@/lib/cms";
import { getFooterContent } from "@/lib/footer";
import { trustIcon } from "@/lib/trust-icons";

/*
  Every word and link here is CMS content — see src/lib/footer.ts, which also
  holds the defaults this renders when Supabase is unconfigured. Layout,
  colours and the logo stay in the component; they are design, not content.
*/
export default async function Footer() {
  const [social, content] = await Promise.all([getSocialLinks(), getFooterContent()]);

  return (
    <footer>
      {/* Trust bar */}
      <section className="border-t border-navy/10 bg-cream">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-4 py-10 lg:grid-cols-4">
          {content.trust.map((item) => {
            const Icon = trustIcon(item.icon);
            return (
            <div key={item.title} className="flex items-center gap-4">
              <Icon size={30} className="shrink-0 text-navy" />
              <div>
                <p className="text-[13px] font-medium tracking-wide text-navy">{item.title}</p>
                {item.body && (
                  <p className="text-[12px] tracking-wide text-navy-400">{item.body}</p>
                )}
              </div>
            </div>
            );
          })}
        </div>
      </section>

      {/* Main footer — navy surface with white logo variant */}
      <section className="bg-navy text-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-14 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Image
              src="/brand/kalima-mark-white.png"
              alt="Kalima"
              width={1563}
              height={1563}
              className="h-20 w-auto"
            />
            <p className="mt-5 max-w-xs text-[13px] leading-relaxed tracking-wide text-white/60">
              {content.tagline}
            </p>
            <SocialLinks
              links={social}
              size={18}
              className="mt-6"
              itemClassName="border-white/20 text-white/70 hover:border-white hover:text-white"
            />
          </div>
          {content.columns.map((col) => (
            <div key={col.heading}>
              <h3 className="label-caps mb-5 text-white/80">{col.heading}</h3>
              <ul className="space-y-3">
                {col.items.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="text-[13px] tracking-wide text-white/60 hover:text-white transition-colors">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-6 text-[11px] tracking-wide text-white/40 lg:flex-row">
            {/*
              The registered name and company number. Malaysian companies must
              identify themselves on their commercial communications, and a
              shopfront is one — so this is a legal line, not decoration, and it
              renders on every page rather than only in the privacy policy.
            */}
            <p className="text-center lg:text-left">
              © {new Date().getFullYear()} Kalima. All rights reserved.
              {content.companyName && (
                <>
                  <br className="hidden lg:block" />
                  <span className="lg:mr-0"> {content.companyName}</span>
                  {content.companyRegNo && <> {content.companyRegNo}</>}
                </>
              )}
            </p>
            {/* Staff only — customers never see it. Convenience, not a guard. */}
            <StaffLink href="/admin" className="hover:text-white/70 transition-colors">
              Back Office
            </StaffLink>
            {content.paymentNote && <p>{content.paymentNote}</p>}
          </div>
        </div>
      </section>
    </footer>
  );
}
