import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    /*
      NO VERCEL IMAGE OPTIMIZATION.

      The optimizer began answering 402 OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED
      on 20 Aug 2026 — the Hobby plan's transformation quota, spent. It failed
      in the cruellest way available: source images already transformed this
      month kept serving from cache while any NEW upload was refused, so the
      homepage looked perfectly fine and the checkout summary showed two broken
      thumbnails. A shop that cannot show a shopper what they are buying at the
      moment they pay is worse than a slow one.

      So the photographs are served straight from Supabase Storage, and the
      files there are WEBP — which is the trade this makes honest. Optimization
      was buying format conversion and per-breakpoint resizing; we keep the
      first by storing the converted files, and give up the second. A phone
      therefore downloads the same file a desktop does.

      `formats` is deliberately gone rather than set: it configures the
      optimizer, and an optimizer that never runs should not appear to be
      configured. remotePatterns stays — Next still validates src hosts.
    */
    unoptimized: true,
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

  /*
    Baseline security headers. There is no XSS sink in the app today — no
    dangerouslySetInnerHTML, no innerHTML, no eval anywhere — so these are
    defence in depth rather than a patch for a live hole. They earn their place
    because /admin runs on the same origin as an unauthenticated storefront and
    had nothing stopping a hostile page framing it.

    NO Content-Security-Policy HERE, DELIBERATELY. A useful CSP for this app has
    to allow Next's inline hydration bootstrap, which means a per-request nonce
    threaded through the proxy — real work with a real chance of silently
    breaking hydration. A wrong CSP is worse than none: it either blocks the app
    or is written loose enough (unsafe-inline) to be theatre. Left for a change
    that can be tested properly rather than bolted on beside unrelated fixes.
  */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // No framing at all: nothing here is meant to be embedded, least of all /admin.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          // Stop a browser second-guessing a declared type into something executable.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Send the origin off-site, never the full path — order references live in paths.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Nothing here needs a camera, a microphone or a location.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          /*
            Two years, subdomains included. Vercel already serves HTTPS only;
            this stops the first request of a session being downgradeable.
            Not preloaded — that is a one-way door and belongs to whoever owns
            the domain, not to a config change.
          */
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
