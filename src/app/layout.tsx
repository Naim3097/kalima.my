import type { Metadata } from "next";
import { Playfair_Display, Jost } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import Providers from "./providers";
import "./globals.css";

/*
  Type pairing per PROJECT_PLAN.md §2.1: editorial serif for display,
  geometric sans for body/nav. next/font self-hosts both and emits the
  CSS variables consumed by @theme in globals.css.
*/
const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});

const jost = Jost({
  subsets: ["latin"],
  variable: "--font-jost",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.kalima.my"),
  title: {
    default: "Kalima — Timeless Modest Luxury",
    template: "%s · Kalima",
  },
  description:
    "Modest luxury designed in Malaysia for every beautiful journey. Premium fabrics, in-house design, inclusive sizing.",
  openGraph: {
    type: "website",
    locale: "en_MY",
    siteName: "Kalima",
  },
  /*
    Proves to Meta that we own kalima.my, which is what lets the Business
    Portfolio own the domain and later attribute conversions to it.

    Rendered server-side into <head>, which is what Meta requires — it explicitly
    refuses a tag injected by client-side JavaScript, so this has to come from
    the Metadata API rather than a useEffect.

    NOTE: while MAINTENANCE_MODE is on, `/` answers 503 from the proxy and this
    tag is never served, because the maintenance page is a standalone HTML string
    that never reaches this layout. Verification during the closed period has to
    go through the DNS TXT method instead. This tag is here for afterwards, and
    for the re-checks Meta runs later.
  */
  verification: {
    other: {
      "facebook-domain-verification": "f2ambcxfiiuzh2kzsqokcw0n0bkoav",
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${playfair.variable} ${jost.variable}`}>
      <body>
        <Providers>{children}</Providers>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
