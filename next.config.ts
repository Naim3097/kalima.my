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
