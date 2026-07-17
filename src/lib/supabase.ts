import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Phase 2+: catalog/auth/orders move to Supabase. Until env vars are set,
// the data layer (src/data/catalog.ts) serves local seed data instead.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;
