import { useState, type FormEvent } from "react";

export default function Newsletter() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    // Phase 2+: persist to Supabase newsletter_subscribers with PDPA consent record
    setDone(true);
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
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              aria-label="Email address"
              className="w-full border border-navy/20 bg-white px-5 py-3.5 text-[14px] tracking-wide text-navy placeholder:text-navy-300 focus:border-navy focus:outline-none"
            />
            <button
              type="submit"
              className="label-caps shrink-0 bg-navy px-8 text-white transition-colors hover:bg-navy-700 cursor-pointer"
            >
              Subscribe
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
