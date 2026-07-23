import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Unsubscribe · Kalima",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Search = { searchParams: Promise<{ token?: string }> };

/*
  One-click unsubscribe, reached from the footer of every marketing email.

  It acts on GET deliberately. Strictly this is a state change, but mail clients
  and the List-Unsubscribe header follow links without a form, and an
  unsubscribe that needs a second click is one people abandon — leaving them
  receiving mail they asked to stop. The token is random per subscriber, so the
  only thing a visitor can do is opt themselves out.

  We record the opt-out rather than deleting the row, so a later import cannot
  silently resurrect someone who said no.
*/
export default async function UnsubscribePage({ searchParams }: Search) {
  const { token } = await searchParams;

  let state: "ok" | "already" | "invalid" = "invalid";
  let email: string | null = null;

  if (token) {
    const db = createAdminClient();
    if (db) {
      const { data } = await db
        .from("newsletter_subscribers")
        .select("id, email, unsubscribed_at")
        .eq("unsubscribe_token", token)
        .maybeSingle();

      if (data) {
        email = data.email as string;
        if (data.unsubscribed_at) {
          state = "already";
        } else {
          await db
            .from("newsletter_subscribers")
            .update({ unsubscribed_at: new Date().toISOString() })
            .eq("id", data.id as string);
          state = "ok";
        }
      }
    }
  }

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 py-20 text-center">
      <h1 className="font-display text-3xl text-navy">
        {state === "invalid" ? "Link not recognised" : "You've been unsubscribed"}
      </h1>

      <p className="mt-4 max-w-md text-[14px] leading-relaxed tracking-wide text-navy-400">
        {state === "ok" && (
          <>
            {email} will no longer receive marketing email from Kalima. Order
            confirmations and shipping updates still arrive, as they are part of your
            purchase.
          </>
        )}
        {state === "already" && (
          <>{email} was already unsubscribed — nothing further to do.</>
        )}
        {state === "invalid" && (
          <>
            That unsubscribe link is missing or no longer valid. If you keep receiving
            mail you did not ask for, reply to any Kalima email and we will remove you.
          </>
        )}
      </p>

      <Link
        href="/"
        className="label-caps mt-8 text-[11px] text-navy-400 transition-colors hover:text-navy"
      >
        ← Back to Kalima
      </Link>
    </main>
  );
}
