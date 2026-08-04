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
