"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { allow, callerKey } from "@/lib/rate-limit";

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
  // Unauthenticated and it writes a consent record — throttle before anything else.
  if (!allow(await callerKey("newsletter"), 5, 60_000)) {
    return { error: "Too many attempts. Please wait a moment." };
  }

  const clean = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
    return { error: "Please enter a valid email address." };
  }

  const db = createAdminClient();
  if (!db) return { error: "Subscriptions are not configured yet." };

  /*
    Note the ABSENCE of `unsubscribed_at: null`.

    This action is unauthenticated — anyone can POST any address — so it must
    not be able to overturn someone's opt-out. Setting unsubscribed_at back to
    null on conflict let an attacker re-subscribe a person who had explicitly
    said no, which is precisely the PDPA outcome the suppression record exists
    to prevent. A brand-new row gets null from the column default; an existing
    unsubscribed row keeps its timestamp untouched. A genuine re-subscribe is a
    separate, confirmed flow, not a side effect of a form anyone can submit.
  */
  const { error } = await db.from("newsletter_subscribers").upsert(
    { email: clean, source, consent_at: new Date().toISOString() },
    { onConflict: "email" },
  );
  if (error) return { error: "Could not subscribe right now. Please try again." };

  return { ok: true };
}
