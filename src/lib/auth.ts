import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

export type Role = "customer" | "staff" | "admin" | "affiliate";

export type CurrentUser = {
  user: User;
  role: Role;
  profile: {
    full_name: string | null;
    phone: string | null;
    marketing_consent: boolean;
  } | null;
};

/*
  The authenticated user for the current request, or null. cache() dedupes so a
  layout and its page share one auth round trip.

  Role is read from the JWT app_metadata claim — the same source RLS uses —
  never from a client-supplied value.
*/
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const role = ((user.app_metadata as { role?: Role } | null)?.role ??
    "customer") as Role;

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone, marketing_consent")
    .eq("id", user.id)
    .maybeSingle();

  return { user, role, profile: profile ?? null };
});

export function isStaff(role: Role | undefined): boolean {
  return role === "staff" || role === "admin";
}
