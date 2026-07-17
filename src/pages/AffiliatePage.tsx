import { useState } from "react";
import { formatRM } from "../lib/format";

const COMMISSIONS = [
  { order: "KLM-10244", date: "14 Jul", amount: 578, commission: 57.8, status: "Pending (return window)" },
  { order: "KLM-10228", date: "11 Jul", amount: 250, commission: 25.0, status: "Approved" },
  { order: "KLM-10195", date: "27 Jun", amount: 862, commission: 86.2, status: "Paid — 30 Jun batch" },
  { order: "KLM-10171", date: "20 Jun", amount: 339, commission: 33.9, status: "Paid — 30 Jun batch" },
];

export default function AffiliatePage() {
  const [copied, setCopied] = useState(false);
  const link = "https://kalima.my/?ref=aisyah";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable in some contexts — demo only */
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-caps text-navy-400">Affiliate Portal</p>
          <h1 className="mt-1 font-display text-4xl text-navy">Welcome back, Aisyah ✨</h1>
        </div>
        <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-[11px] uppercase tracking-wider text-amber-900">
          Demo preview — Phase 6
        </span>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: "Clicks (30d)", value: "4,212" },
          { label: "Orders (30d)", value: "218" },
          { label: "Conversion", value: "5.2%" },
          { label: "Earnings (30d)", value: "RM5,643" },
        ].map((s) => (
          <div key={s.label} className="border border-navy/10 bg-white px-5 py-4">
            <p className="label-caps text-navy-400">{s.label}</p>
            <p className="mt-2 font-display text-3xl text-navy">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Link & code */}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="border border-navy/10 bg-white px-5 py-5">
          <p className="label-caps mb-3 text-navy-400">Your referral link</p>
          <div className="flex gap-2">
            <code className="flex-1 truncate border border-navy/15 bg-cream-50 px-4 py-3 text-[13px] text-navy">{link}</code>
            <button onClick={copy} className="label-caps bg-navy px-5 text-white hover:bg-navy-700 transition-colors cursor-pointer">
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-[12px] tracking-wide text-navy-300">30-day cookie — you're credited even if they buy later</p>
        </div>
        <div className="border border-navy/10 bg-white px-5 py-5">
          <p className="label-caps mb-3 text-navy-400">Your code — followers get 10% off</p>
          <div className="flex items-center justify-between border border-dashed border-navy/30 bg-cream-50 px-4 py-3">
            <code className="font-display text-2xl tracking-[0.2em] text-navy">AISYAH10</code>
            <span className="text-[12px] tracking-wide text-navy-400">You earn 10% per order</span>
          </div>
        </div>
      </div>

      {/* Commissions */}
      <div className="mt-6 border border-navy/10 bg-white">
        <div className="flex items-center justify-between border-b border-navy/10 px-5 py-4">
          <h2 className="label-caps !text-[12px]">Recent commissions</h2>
          <span className="text-[12px] tracking-wide text-navy-400">Payouts monthly via DuitNow</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-navy/10">
                {["Order", "Date", "Order value", "Your commission", "Status"].map((h) => (
                  <th key={h} className="label-caps whitespace-nowrap px-5 py-3 !text-[10px] text-navy-400">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-navy/5">
              {COMMISSIONS.map((c) => (
                <tr key={c.order} className="hover:bg-cream-50">
                  <td className="px-5 py-3.5 font-medium text-navy">{c.order}</td>
                  <td className="px-5 py-3.5 text-navy-400">{c.date}</td>
                  <td className="px-5 py-3.5 text-navy">{formatRM(c.amount)}</td>
                  <td className="px-5 py-3.5 font-medium text-navy">{formatRM(c.commission)}</td>
                  <td className="px-5 py-3.5 text-navy-400">{c.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border border-navy/10 bg-beige px-5 py-4">
        <p className="text-[13px] tracking-wide text-navy">
          📁 Campaign assets — approved photos, captions & story templates for the Maya Collection
        </p>
        <button className="label-caps border border-navy/40 px-4 py-2 text-navy hover:border-navy transition-colors cursor-pointer">
          Download pack
        </button>
      </div>
    </div>
  );
}
