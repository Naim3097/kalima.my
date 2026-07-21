"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/* Client Component — controlled email input + submit handler. */
export default function Newsletter() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    // Demo only — Phase 2+: persist to Supabase newsletter_subscribers with PDPA consent record
    setDone(true);
    toast.success("Welcome to Kalima Club", {
      description: `We'll send the next drop to ${email.trim()}.`,
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
            <Button type="submit" variant="kalima" size="editorial" className="shrink-0 px-8 py-0">
              Subscribe
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}
