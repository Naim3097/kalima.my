import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AffiliateApply } from "@/components/affiliate/AffiliateApply";
import { CopyField } from "@/components/affiliate/CopyField";
import { getCurrentUser } from "@/lib/auth";
import {
  getAffiliateStats,
  getMyAffiliate,
  listPayouts,
  listReferrals,
} from "@/lib/affiliate";
import { formatRM } from "@/lib/format";

export const metadata: Metadata = {
  // The root layout appends "· Kalima" via its title template.
  title: "Affiliate",
  description: "Your Kalima affiliate dashboard.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://kalima.my";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-navy/10 bg-white px-5 py-4">
      <p className="label-caps text-[10px] text-navy-400">{label}</p>
      <p className="mt-1 font-display text-2xl text-navy">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] tracking-wide text-navy-400">{hint}</p>}
    </div>
  );
}

/*
  Affiliate portal.

  Signed-in customers who have not applied see the application form; pending
  applicants see their status; approved affiliates see their link, code and
  earnings. Balances are split into held vs payable because "when do I actually
  get paid" is the question this page exists to answer.
*/
export default async function AffiliatePage() {
  const current = await getCurrentUser();
  if (!current) redirect("/login?next=/affiliate");

  const affiliate = await getMyAffiliate();

  if (!affiliate) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-16">
        <AffiliateApply defaultName={current.profile?.full_name ?? ""} />
      </main>
    );
  }

  if (affiliate.status !== "approved") {
    const suspended = affiliate.status === "suspended";
    return (
      <main className="mx-auto max-w-2xl px-4 py-20 text-center">
        <h1 className="font-display text-3xl text-navy">
          {suspended ? "Your affiliate account is paused" : "Application received"}
        </h1>
        <p className="mt-4 text-[14px] leading-relaxed tracking-wide text-navy-400">
          {suspended
            ? "Please contact us and we'll get it sorted."
            : "We're reviewing your application and will be in touch by email. Nothing to do for now."}
        </p>
        <Link href="/" className="label-caps mt-8 inline-block text-[11px] text-navy-400 hover:text-navy">
          ← Back to Kalima
        </Link>
      </main>
    );
  }

  const [stats, referrals, payouts] = await Promise.all([
    getAffiliateStats(affiliate.id),
    listReferrals(affiliate.id),
    listPayouts(affiliate.id),
  ]);

  const link = `${APP_URL}/?ref=${affiliate.slug}`;

  return (
    <main className="mx-auto max-w-5xl px-4 py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-navy">Affiliate dashboard</h1>
          <p className="mt-1 text-[13px] tracking-wide text-navy-400">
            {affiliate.name} · {(affiliate.commissionBps / 100).toFixed(affiliate.commissionBps % 100 ? 1 : 0)}% commission
          </p>
        </div>
      </div>

      {/* Sharing tools */}
      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        <CopyField label="Your referral link" value={link} />
        {affiliate.discountCode ? (
          <CopyField label="Your discount code" value={affiliate.discountCode} />
        ) : (
          <div>
            <p className="label-caps text-[10px] text-navy-400">Your discount code</p>
            <p className="mt-1 border border-dashed border-navy/15 px-3 py-2.5 text-[13px] text-navy-400">
              Not issued yet — your link works on its own.
            </p>
          </div>
        )}
      </section>

      {/* Earnings */}
      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Clicks" value={String(stats.clicks)} />
        <Stat label="Orders" value={String(stats.orders)} />
        <Stat
          label="Held"
          value={formatRM(stats.pendingSen / 100)}
          hint="Inside the 14-day return window"
        />
        <Stat
          label="Payable"
          value={formatRM(stats.payableSen / 100)}
          hint="Cleared — due at the next payout"
        />
      </section>

      {(stats.paidSen > 0 || stats.clawedBackSen > 0) && (
        <p className="mt-3 text-[12px] tracking-wide text-navy-400">
          {formatRM(stats.paidSen / 100)} paid to date
          {stats.clawedBackSen > 0 && ` · ${formatRM(stats.clawedBackSen / 100)} reversed from refunded orders`}
        </p>
      )}

      {/* Referrals */}
      <section className="mt-10">
        <h2 className="font-display text-xl text-navy">Referred orders</h2>
        {referrals.length === 0 ? (
          <p className="mt-3 text-[13px] tracking-wide text-navy-400">
            No referred orders yet. Share your link — commission appears here once an
            order is paid.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto border border-navy/10 bg-white">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-navy/10">
                  <th className="label-caps px-4 py-3 text-[10px] text-navy-400">Order</th>
                  <th className="label-caps px-4 py-3 text-[10px] text-navy-400">Via</th>
                  <th className="label-caps px-4 py-3 text-[10px] text-navy-400">Order value</th>
                  <th className="label-caps px-4 py-3 text-[10px] text-navy-400">Commission</th>
                  <th className="label-caps px-4 py-3 text-[10px] text-navy-400">Status</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r) => {
                  const held = r.status !== "paid" && r.status !== "clawed_back" &&
                    new Date(r.holdUntil).getTime() > Date.now();
                  return (
                    <tr key={r.id} className="border-b border-navy/5 last:border-0">
                      <td className="px-4 py-3">{r.orderReference ?? "—"}</td>
                      <td className="px-4 py-3 text-navy-400">{r.source}</td>
                      <td className="px-4 py-3 tabular-nums">{formatRM(r.baseSen / 100)}</td>
                      <td className="px-4 py-3 tabular-nums">{formatRM(r.commissionSen / 100)}</td>
                      <td className="px-4 py-3 text-navy-400">
                        {r.status === "clawed_back"
                          ? "Reversed (refunded)"
                          : r.status === "paid"
                            ? "Paid"
                            : held
                              ? `Held until ${new Date(r.holdUntil).toLocaleDateString("en-MY", { day: "numeric", month: "short" })}`
                              : "Payable"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {payouts.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-xl text-navy">Payouts</h2>
          <ul className="mt-3 space-y-2">
            {payouts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 border border-navy/10 bg-white px-4 py-3 text-[13px]">
                <span>{new Date(p.paidAt).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}</span>
                <span className="text-navy-400">{p.reference ?? "—"}</span>
                <span className="tabular-nums">{formatRM(p.amountSen / 100)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
