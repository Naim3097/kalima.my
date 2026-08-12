import Link from "next/link";
import StaffLink from "@/components/layout/StaffLink";
import Image from "next/image";
import {
  TruckIcon,
  ReturnIcon,
  ShieldIcon,
  HeadsetIcon,
} from "@/components/brand/Icons";

const TRUST = [
  { icon: TruckIcon, title: "Free Shipping", body: "For orders above RM300" },
  { icon: ReturnIcon, title: "Easy Returns", body: "14 days return policy" },
  { icon: ShieldIcon, title: "Secure Payment", body: "100% secure checkout" },
  { icon: HeadsetIcon, title: "Customer Support", body: "We're here to help" },
];

const LINKS: { heading: string; items: { label: string; href: string }[] }[] = [
  {
    heading: "Shop",
    items: [
      { label: "Women", href: "/collections/women" },
      { label: "Men", href: "/collections/men" },
      { label: "Accessories", href: "/collections/accessories" },
      { label: "New Arrivals", href: "/collections/new-arrivals" },
      { label: "Best Sellers", href: "/collections/best-sellers" },
    ],
  },
  {
    heading: "Help",
    items: [
      { label: "Shipping", href: "/pages/shipping" },
      { label: "Returns & Exchanges", href: "/pages/returns" },
      { label: "Size Guide", href: "/pages/size-guide" },
      { label: "Contact Us", href: "/pages/contact" },
      // Meta checks that the Privacy Policy URL it was given is actually
      // reachable from the site, not just a bare URL typed into a form.
      { label: "Privacy Policy", href: "/pages/privacy" },
    ],
  },
  {
    heading: "Kalima",
    items: [
      { label: "About Kalima", href: "/pages/about-kalima" },
      { label: "Our Fabrics", href: "/pages/fabrics" },
      { label: "Stores", href: "/pages/stores" },
      /* /kalima-club is the live programme; /pages/kalima-club is a CMS page
         still saying "launching soon". Point people at the working one. */
      { label: "Kalima Club", href: "/kalima-club" },
      { label: "Refer a Friend", href: "/affiliate" },
      /* The only account link that does not depend on the header's role
         logic — shoppers expect one at the bottom of the page, and staff
         have no other desktop route to their own account. */
      { label: "My Account", href: "/account" },
    ],
  },
];

export default function Footer() {
  return (
    <footer>
      {/* Trust bar */}
      <section className="border-t border-navy/10 bg-cream">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-4 py-10 lg:grid-cols-4">
          {TRUST.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex items-center gap-4">
              <Icon size={30} className="shrink-0 text-navy" />
              <div>
                <p className="text-[13px] font-medium tracking-wide text-navy">{title}</p>
                <p className="text-[12px] tracking-wide text-navy-400">{body}</p>
              </div>
            </div>
          ))}
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
              Timeless modest luxury — designed in Malaysia for every beautiful journey.
            </p>
          </div>
          {LINKS.map((col) => (
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
            <p>© {new Date().getFullYear()} Kalima. All rights reserved.</p>
            {/* Staff only — customers never see it. Convenience, not a guard. */}
            <StaffLink href="/admin" className="hover:text-white/70 transition-colors">
              Back Office
            </StaffLink>
            <p>FPX · Visa · Mastercard · GrabPay — secure checkout</p>
          </div>
        </div>
      </section>
    </footer>
  );
}
