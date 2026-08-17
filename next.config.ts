import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    // Photoshoot imagery is served from /public today; Supabase Storage lands in Phase 2.
    formats: ["image/avif", "image/webp"],
    /*
      Storage hosts allowed for next/image.

      The configured project's host is derived, so it follows whichever Supabase
      project the environment points at and needs no code change per environment.

      NEXT_PUBLIC_LEGACY_IMAGE_HOST adds a SECOND host, and exists for staging:
      its catalogue is copied from production, so product_images.url still points
      at production's public bucket. next/image rejects any host not listed here,
      so without it every photo on staging fails to render while uploads made ON
      staging (which land in staging's own bucket) work fine — a confusing split.
      Unset in production, where the derived host is already the right one.
    */
    remotePatterns: [
      ...(process.env.NEXT_PUBLIC_SUPABASE_URL
        ? [
            {
              protocol: "https" as const,
              hostname: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,
              pathname: "/storage/v1/object/public/**",
            },
          ]
        : []),
      ...(process.env.NEXT_PUBLIC_LEGACY_IMAGE_HOST
        ? [
            {
              protocol: "https" as const,
              hostname: process.env.NEXT_PUBLIC_LEGACY_IMAGE_HOST,
              pathname: "/storage/v1/object/public/**",
            },
          ]
        : []),
    ],
  },
};

export default nextConfig;
