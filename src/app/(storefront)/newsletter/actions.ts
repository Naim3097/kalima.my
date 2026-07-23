"use server";

import { createAdminClient } from "@/lib/supabase/server";

/*
  Footer "Join Kalima Club" signup.

  Replaces a demo handler that showed a success toast and stored nothing —
  which is worse than no signup form, because it tells someone they have
  subscribed when they have not.

  Consent is recorded with a timestamp and a source, which is what a PDPA
  request would need to see. Re-subscribing an address that previously opted out
  clears the opt-out, because typing your address into the box again IS fresh
  consent.
*/
export async function subscribeToNewsletter(
  email: string,
  source = "footer",
): Promise<{ ok: true } | { error: string }> {
  const clean = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
    return { error: "Please enter a valid email address." };
  }

  const db = createAdminClient();
  if (!db) return { error: "Subscriptions are not configured yet." };

  const { error } = await db.from("newsletter_subscribers").upsert(
    { email: clean, source, consent_at: new Date().toISOString(), unsubscribed_at: null },
    { onConflict: "email" },
  );
  if (error) return { error: "Could not subscribe right now. Please try again." };

  return { ok: true };
}
