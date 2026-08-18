import { cookies } from "next/headers";
import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/*
  Server-side Supabase client for Server Components, Route Handlers and
  Server Actions. Reads the session from cookies so RLS applies as the
  signed-in user. Returns null until env vars are configured.

  Must be created per-request — never hoisted to a module-level singleton,
  or one user's session would leak into another's request.
*/
export async function createClient(): Promise<SupabaseClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Session refresh is handled by middleware instead — safe to ignore.
        }
      },
    },
  });
}

/*
  Session-less client for reading *public* data.

  Two reasons this exists rather than everything going through createClient():

  1. generateStaticParams() runs at build time with no HTTP request and throws
     if anything touches cookies().
  2. Reading cookies opts a route out of static rendering entirely. The catalog
     is identical for every anonymous visitor, so routing it through the
     session-aware client would make every product and collection page
     dynamic for no benefit.

  Uses the anon key, so RLS still applies and only published rows are visible.
  Anything user-specific (orders, account, staff previews of unpublished rows)
  must use createClient() instead and accept dynamic rendering.
*/
export function createPublicClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  return createServerClient(url, anonKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}

/*
  Service-role client: bypasses RLS entirely. Use only in Route Handlers for
  admin operations and webhook processing, never in anything that renders to
  the browser. Guarded so the key can never be read client-side.
*/
export function createAdminClient(): SupabaseClient | null {
  if (typeof window !== "undefined") {
    throw new Error("createAdminClient() must never run in the browser");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  return createServerClient(url, serviceKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}
