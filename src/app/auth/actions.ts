"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/*
  Server Actions for auth. Kept minimal and typed: each returns an error
  string on failure so the form can render it inline, and redirects on
  success. Supabase's cookie-based session is written by the server client.
*/

export type AuthResult = { error: string } | void;

function safeNext(next: FormDataEntryValue | null): string {
  // Only allow same-site relative paths — never an open redirect.
  const value = typeof next === "string" ? next : "";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/account";
}

export async function signIn(formData: FormData): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) return { error: "Email and password are required." };

  const supabase = await createClient();
  if (!supabase) return { error: "Authentication is not configured." };

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect(next);
}

export async function signUp(formData: FormData): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const marketingConsent = formData.get("marketing_consent") === "on";

  if (!email || !password) return { error: "Email and password are required." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const supabase = await createClient();
  if (!supabase) return { error: "Authentication is not configured." };

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Feeds the handle_new_user_profile() trigger (full_name, phone, consent).
      data: {
        full_name: fullName || null,
        phone: phone || null,
        marketing_consent: marketingConsent,
      },
      emailRedirectTo: `${await siteUrl()}/auth/callback`,
    },
  });
  if (error) return { error: error.message };

  // Email confirmation is on, so there is no session yet — the caller shows a
  // "check your inbox" state rather than redirecting into the app.
  redirect("/login?confirm=1");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

/*
  Step 1 of password reset: email a recovery link. The link lands on
  /auth/callback, which exchanges the code for a (recovery) session and
  forwards to /reset-password.

  Never reveals whether the account exists — Supabase returns success for
  unknown emails, and we redirect to the same "check your inbox" state
  regardless. Only a genuine send failure (rate limit, misconfig) surfaces.
*/
export async function requestPasswordReset(formData: FormData): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Email is required." };

  const supabase = await createClient();
  if (!supabase) return { error: "Authentication is not configured." };

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await siteUrl()}/auth/callback?next=/reset-password`,
  });
  if (error) return { error: error.message };

  redirect("/forgot-password?sent=1");
}

/*
  Step 2: set the new password. Runs inside the recovery session established by
  the callback, so getUser() must resolve — if it doesn't, the link expired.
*/
export async function updatePassword(formData: FormData): Promise<AuthResult> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password !== confirm) return { error: "Passwords do not match." };

  const supabase = await createClient();
  if (!supabase) return { error: "Authentication is not configured." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Your reset link has expired. Request a new one." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect("/account");
}

/** Absolute site origin for auth redirect links. */
async function siteUrl(): Promise<string> {
  const { headers } = await import("next/headers");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
