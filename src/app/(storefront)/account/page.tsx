import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { formatRM } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

export const metadata: Metadata = {
  title: "My Account",
  description:
    "Your Kalima Club dashboard — points balance, tier progress, order history and saved details.",
};

const MOCK_ORDERS = [
  { id: "KLM-10248", date: "17 Jul 2026", items: "Maya Chiffon (M), Satin Shawl", total: 339, status: "Paid — preparing", tracking: null },
  { id: "KLM-10201", date: "28 Jun 2026", items: "Bella Dress (S)", total: 289, status: "Delivered", tracking: "EP934601827MY" },
  { id: "KLM-10142", date: "9 Jun 2026", items: "Sofea Dress (M), Rayon Inner", total: 319, status: "Delivered", tracking: "EP934418805MY" },
];

const POINTS_HISTORY = [
  { date: "28 Jun", event: "Order KLM-10201 — points credited", delta: "+289" },
  { date: "15 Jun", event: "Redeemed at checkout (KLM-10142)", delta: "−1,000" },
  { date: "9 Jun", event: "Order KLM-10142 — points credited", delta: "+319" },
  { date: "2 Jun", event: "Birthday voucher bonus 🎂", delta: "+200" },
];

/*
  Fully static — the Kalima Club dashboard reads demo data only, so the whole
  page stays a Server Component. The tier meter uses shadcn Progress (a client
  primitive) but nothing else here ships interactivity.
*/
export default function AccountPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-caps text-navy-400">My Account</p>
          <h1 className="mt-1 font-display text-4xl text-navy">Salam, Nurul Aisyah</h1>
        </div>
        <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-[11px] uppercase tracking-wider text-amber-900">
          Demo preview — Phases 2 &amp; 7
        </span>
      </div>

      {/* Kalima Club card */}
      <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="bg-navy p-8 text-white">
          <div className="flex items-start justify-between">
            <div>
              <p className="label-caps text-white/60">Kalima Club</p>
              <p className="mt-2 font-display text-3xl">Gold Member</p>
            </div>
            <Image
              src="/brand/kalima-mark-white.png"
              alt=""
              width={48}
              height={48}
              className="h-12 w-auto opacity-80"
            />
          </div>
          <div className="mt-8 flex items-end justify-between">
            <div>
              <p className="label-caps text-white/60">Points balance</p>
              <p className="mt-1 font-display text-4xl">1,250</p>
              <p className="mt-1 text-[12px] tracking-wide text-white/50">= RM62.50 off your next order</p>
            </div>
            <div className="text-right text-[12px] tracking-wide text-white/60">
              <p>1.5× points on every order</p>
              <p>Free shipping, always</p>
            </div>
          </div>
          <div className="mt-8">
            <div className="mb-1.5 flex justify-between text-[12px] tracking-wide text-white/60">
              <span>Progress to Platinum</span>
              <span>RM2,680 / RM3,000</span>
            </div>
            <Progress
              value={89}
              aria-label="Progress to Platinum tier"
              className="h-1.5 rounded-none bg-white/15 *:data-[slot=progress-indicator]:bg-white"
            />
            <p className="mt-2 text-[12px] tracking-wide text-white/50">
              RM320 more this year unlocks private sales, RM50 birthday voucher &amp; priority support
            </p>
          </div>
        </div>

        {/* Points history */}
        <div className="border border-navy/10 bg-white">
          <div className="border-b border-navy/10 px-5 py-4">
            <h2 className="label-caps !text-[12px]">Points activity</h2>
          </div>
          <ul className="divide-y divide-navy/5 px-5">
            {POINTS_HISTORY.map((p) => (
              <li key={p.event} className="flex items-center justify-between gap-4 py-3.5 text-[13px]">
                <div>
                  <p className="text-navy">{p.event}</p>
                  <p className="text-[11px] text-navy-300">{p.date}</p>
                </div>
                <span className={p.delta.startsWith("+") ? "text-emerald-700" : "text-navy-400"}>{p.delta}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Orders */}
      <section className="mt-10">
        <h2 className="label-caps mb-4 !text-[13px]">Order History</h2>
        <div className="space-y-3">
          {MOCK_ORDERS.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center justify-between gap-4 border border-navy/10 bg-white px-5 py-4">
              <div>
                <p className="text-[14px] font-medium text-navy">{o.id}</p>
                <p className="mt-0.5 text-[12px] tracking-wide text-navy-400">
                  {o.date} · {o.items}
                </p>
              </div>
              <div className="flex items-center gap-6">
                <span className="text-[14px] text-navy">{formatRM(o.total)}</span>
                <Badge
                  variant="ghost"
                  className={`rounded-full px-3 py-1 text-[10px] font-normal uppercase tracking-wider ${
                    o.status === "Delivered" ? "bg-emerald-100 text-emerald-900" : "bg-navy-100 text-navy"
                  }`}
                >
                  {o.status}
                </Badge>
                {o.tracking ? (
                  <span className="text-[12px] tracking-wide text-navy-400">{o.tracking}</span>
                ) : (
                  <span className="text-[12px] tracking-wide text-navy-300">Tracking soon via WhatsApp</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Profile blocks */}
      <section className="mt-10 grid gap-4 md:grid-cols-3">
        {[
          { title: "Profile", body: "Nurul Aisyah · nurul@email.com · +60 12-345 6789 · WhatsApp updates ON" },
          { title: "Address book", body: "12, Jalan Setia 3/2, 40170 Shah Alam, Selangor (default)" },
          { title: "Preferences", body: "Kalima Club member since Mar 2025 · PDPA consent given · Birthday: 2 June" },
        ].map((b) => (
          <div key={b.title} className="border border-navy/10 bg-white px-5 py-4">
            <h3 className="label-caps !text-[12px]">{b.title}</h3>
            <p className="mt-2 text-[13px] leading-relaxed tracking-wide text-navy-400">{b.body}</p>
            <button className="mt-3 cursor-pointer text-[12px] text-navy underline underline-offset-4">Edit</button>
          </div>
        ))}
      </section>

      <p className="mt-8 text-[12px] tracking-wide text-navy-300">
        Are you a content creator?{" "}
        <Link href="/affiliate" className="text-navy underline underline-offset-4">
          Join the Kalima affiliate program →
        </Link>
      </p>
    </div>
  );
}
