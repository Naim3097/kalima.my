"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/*
  Browser-side Supabase client. Returns null until env vars are configured,
  so the seed-data path in src/data/catalog.ts stays the fallback (Phase 2).
  Callers must handle null rather than assume a client exists.
*/
export function createClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createBrowserClient(url, anonKey);
}
