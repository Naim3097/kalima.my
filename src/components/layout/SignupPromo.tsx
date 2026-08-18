"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CloseIcon } from "@/components/brand/Icons";
import { Button } from "@/components/ui/button";
import type { SignupPromo as Promo } from "@/lib/cms";

/*
  The sign-up offer, shown once to a visitor who is not a member.

  WHO SEES IT is decided on the SERVER — the layout renders this only for a
  signed-out visitor, so a member never downloads a component telling them to
  join. WHEN they see it is decided here, because it depends on things the
  server cannot know: how long they have stayed, and whether they have already
  said no.

  DISMISSAL IS REMEMBERED, and that is most of the design. A popup that returns
  on every page is not a promotion, it is a fault the visitor cannot fix. The
  timestamp goes in localStorage rather than a cookie: it is a preference this
  device holds, nothing on the server needs it, and it should not ride along on
  every request. Clicking through to sign up counts as dismissal too — the offer
  has done its job and should not reappear behind the form.

  WHERE IT DOES NOT APPEAR: the pages where the visitor is already doing the
  thing, or doing something more important. Interrupting a checkout to ask
  someone to register is how a full bag is abandoned.
*/

const STORAGE_KEY = "kalima_promo_dismissed_at";

/* Prefixes that suppress it. Matched with startsWith, so /account/orders is
   covered by /account. */
const SILENT_PATHS = [
  "/signup",
  "/login",
  "/checkout",
  "/account",
  "/affiliate",
  "/reset-password",
  "/forgot-password",
  "/admin",
];

export default function SignupPromo({ promo }: { promo: Promo }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const silent = SILENT_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (silent) return;

    /*
      A dismissal within the window keeps it closed. An unreadable or malformed
      value is treated as "never dismissed" rather than throwing — a corrupt
      localStorage entry should not take the whole storefront down with it.
    */
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const dismissedAt = Number(raw);
        const ageDays = (Date.now() - dismissedAt) / 86_400_000;
        if (Number.isFinite(dismissedAt) && ageDays < promo.dismissDays) return;
      }
    } catch {
      // Private browsing, storage disabled — show it and let them close it.
    }

    const timer = setTimeout(() => setOpen(true), promo.delaySeconds * 1000);
    return () => clearTimeout(timer);
  }, [silent, promo.delaySeconds, promo.dismissDays]);

  function dismiss() {
    setOpen(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      // Nothing to do — it reappears next visit, which is the safe direction.
    }
  }

  /* Escape closes it, as any dialog should. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open || silent) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="promo-heading"
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
    >
      {/* Backdrop. Clicking it dismisses, which is what people try first. */}
      <button
        type="button"
        aria-label="Close"
        onClick={dismiss}
        className="absolute inset-0 cursor-default bg-navy/50"
      />

      <div className="animate-hero-fade relative w-full max-w-md border border-navy/10 bg-cream p-8 shadow-xl">
        <button
          type="button"
          onClick={dismiss}
          aria-label="Close"
          className="absolute right-4 top-4 cursor-pointer text-navy-400 transition-colors hover:text-navy"
        >
          <CloseIcon size={18} />
        </button>

        {promo.eyebrow && (
          <p className="label-caps mb-4 flex items-center gap-3 text-navy-400">
            <span className="h-px w-9 bg-navy-300" aria-hidden />
            {promo.eyebrow}
          </p>
        )}

        <h2 id="promo-heading" className="font-display text-3xl leading-tight text-navy">
          {promo.heading}
        </h2>

        {promo.body && (
          <p className="mt-4 text-[14px] leading-relaxed tracking-wide text-navy-400">
            {promo.body}
          </p>
        )}

        {promo.perks.length > 0 && (
          <ul className="mt-6 space-y-2.5">
            {promo.perks.map((perk) => (
              <li key={perk} className="flex items-start gap-3 text-[14px] tracking-wide text-navy">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-navy" aria-hidden />
                {perk}
              </li>
            ))}
          </ul>
        )}

        <Button asChild variant="kalima" size="editorial" className="mt-6 w-full">
          <Link href={promo.ctaHref} onClick={dismiss}>
            {promo.ctaLabel}
          </Link>
        </Button>

        <p className="mt-4 text-center text-[12px] tracking-wide text-navy-400">
          Already a member?{" "}
          <Link href="/login" onClick={dismiss} className="text-navy underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
