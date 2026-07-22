"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type AuthState = { signedIn: boolean; isStaff: boolean; ready: boolean };

/*
  Lightweight client-side auth state for header UX (Account vs Sign in). Read
  in the browser on purpose: the storefront layout must stay statically
  rendered, and reading the session server-side in the shared header would opt
  every page out of static rendering.

  This is UX only — route protection is enforced server-side in proxy.ts and
  in the admin/account server components. Never gate anything security-relevant
  on this hook.
*/
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    signedIn: false,
    isStaff: false,
    ready: false,
  });

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) {
      setState({ signedIn: false, isStaff: false, ready: true });
      return;
    }

    let active = true;
    const resolve = (user: User | null) => {
      if (!active) return;
      const role = (user?.app_metadata as { role?: string } | undefined)?.role;
      setState({
        signedIn: !!user,
        isStaff: role === "staff" || role === "admin",
        ready: true,
      });
    };

    supabase.auth.getUser().then(({ data }) => resolve(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) =>
      resolve(session?.user ?? null),
    );

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
