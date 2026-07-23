"use client";

import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { subscribeToNewsletter } from "@/app/(storefront)/newsletter/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/*
  Client Component — controlled email input + submit handler.

  The success state only appears once the subscription is actually stored. The
  previous version showed it unconditionally and persisted nothing, telling
  people they had joined a list that did not exist.
*/
export default function Newsletter() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    startTransition(async () => {
      const res = await subscribeToNewsletter(email);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setDone(true);
      toast.success("Welcome to Kalima Club", {
        description: `We'll send the next drop to ${email.trim()}.`,
      });
    });
  };

  return (
    <section className="bg-beige">
      <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-14 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-3xl text-navy lg:text-4xl">Join Kalima Club</h2>
          <p className="mt-3 max-w-md text-[14px] leading-relaxed tracking-wide text-navy-400">
            Be the first to know about new collections, exclusive offers and private sales.
          </p>
        </div>
        {done ? (
          <p className="font-display text-xl text-navy lg:justify-self-end">
            Welcome to the Club — see you in your inbox. ✨
          </p>
        ) : (
          <form onSubmit={submit} className="flex w-full max-w-lg lg:justify-self-end">
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              aria-label="Email address"
              className="h-auto w-full border-navy/20 bg-white px-5 py-3.5 text-[14px] tracking-wide text-navy shadow-none placeholder:text-navy-300 focus-visible:border-navy focus-visible:ring-0 md:text-[14px]"
            />
            <Button
              type="submit"
              variant="kalima"
              size="editorial"
              disabled={pending}
              className="shrink-0 px-8 py-0"
            >
              {pending ? "Joining…" : "Subscribe"}
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}
