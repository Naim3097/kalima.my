import type { Metadata } from "next";
import Link from "next/link";
import { getTiers, getMyClub, getLoyaltyRules } from "@/lib/loyalty";
import { formatRM } from "@/lib/format";

export const metadata: Metadata = {
  title: "Kalima Club",
  description: "Earn points on every order, unlock tiers, enjoy member rewards.",
};

export const dynamic = "force-dynamic";

/*
  Kalima Club.

  Signed out, this is the scheme explained — tiers and earn rate, so it works as
  a marketing page. Signed in, it becomes the member's standing: balance, what
  it is worth, tier progress and history.
*/
export default async function KalimaClubPage() {
  const [club, tiers, rules] = await Promise.all([getMyClub(), getTiers(), getLoyaltyRules()]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-14">
      <header className="text-center">
        <h1 className="font-display text-4xl text-navy">Kalima Club</h1>
        <p className="mx-auto mt-3 max-w-xl text-[14px] leading-relaxed tracking-wide text-navy-400">
          Earn {rules.pointsPerRm} point{rules.pointsPerRm === 1 ? "" : "s"} for every ringgit you
          spend. {100} points are worth {formatRM((100 * rules.senPerPoint) / 100)} off a future
          order. Points are added once an order is complete and last{" "}
          {rules.expiryMonths} months.
        </p>
      </header>

      {club ? (
        <>
          {/* Member standing */}
          <section className="mt-10 grid gap-4 sm:grid-cols-3">
            <div className="border border-navy/10 bg-white px-5 py-5 text-center">
              <p className="label-caps text-[10px] text-navy-400">Your points</p>
              <p className="mt-1 font-display text-3xl text-navy">{club.balance}</p>
              <p className="text-[12px] tracking-wide text-navy-400">
                worth {formatRM(club.valueSen / 100)}
              </p>
            </div>
            <div className="border border-navy/10 bg-white px-5 py-5 text-center">
              <p className="label-caps text-[10px] text-navy-400">Your tier</p>
              <p className="mt-1 font-display text-3xl text-navy">{club.tier.name}</p>
              <p className="text-[12px] tracking-wide text-navy-400">
                {(club.tier.multiplierBps / 10000).toFixed(club.tier.multiplierBps % 10000 ? 1 : 0)}×
                points{club.tier.freeShipping ? " · free shipping" : ""}
              </p>
            </div>
            <div className="border border-navy/10 bg-white px-5 py-5 text-center">
              <p className="label-caps text-[10px] text-navy-400">Spend (12 months)</p>
              <p className="mt-1 font-display text-3xl text-navy">
                {formatRM(club.spend12mSen / 100)}
              </p>
              <p className="text-[12px] tracking-wide text-navy-400">
                {club.nextTier
                  ? `${formatRM(club.toNextTierSen / 100)} to ${club.nextTier.name}`
                  : "Top tier reached"}
              </p>
            </div>
          </section>

          {club.nextTier && (
            <div className="mt-4">
              <div className="h-1.5 w-full overflow-hidden bg-navy/10">
                <div
                  className="h-full bg-navy transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round((club.spend12mSen / club.nextTier.minSpendSen) * 100),
                    )}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* History */}
          <section className="mt-10">
            <h2 className="font-display text-xl text-navy">Points history</h2>
            {club.entries.length === 0 ? (
              <p className="mt-3 text-[13px] tracking-wide text-navy-400">
                No points yet — they arrive once your first order is complete.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-navy/5 border border-navy/10 bg-white">
                {club.entries.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div>
                      <p className="text-[13px] text-navy">{e.reason ?? e.type}</p>
                      <p className="text-[11px] tracking-wide text-navy-400">
                        {new Date(e.createdAt).toLocaleDateString("en-MY", {
                          day: "numeric", month: "short", year: "numeric",
                        })}
                        {e.expiresAt &&
                          ` · expires ${new Date(e.expiresAt).toLocaleDateString("en-MY", {
                            month: "short", year: "numeric",
                          })}`}
                      </p>
                    </div>
                    <span
                      className={`text-[15px] tabular-nums ${
                        e.points >= 0 ? "text-navy" : "text-navy-400"
                      }`}
                    >
                      {e.points >= 0 ? "+" : ""}
                      {e.points}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <p className="mt-8 text-center text-[14px] tracking-wide text-navy-400">
          <Link href="/login?next=/kalima-club" className="text-navy underline underline-offset-2">
            Sign in
          </Link>{" "}
          to see your points and tier.
        </p>
      )}

      {/* Tiers */}
      <section className="mt-14">
        <h2 className="text-center font-display text-2xl text-navy">Tiers</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {tiers.map((t) => {
            const mine = club?.tier.name === t.name;
            return (
              <div
                key={t.name}
                className={`border px-5 py-6 text-center ${
                  mine ? "border-navy bg-white" : "border-navy/10 bg-white/60"
                }`}
              >
                <p className="font-display text-xl text-navy">{t.name}</p>
                <p className="mt-1 text-[12px] tracking-wide text-navy-400">
                  {t.minSpendSen === 0
                    ? "On joining"
                    : `${formatRM(t.minSpendSen / 100)} spend in 12 months`}
                </p>
                <ul className="mt-3 space-y-1 text-[13px] text-navy">
                  <li>
                    {(t.multiplierBps / 10000).toFixed(t.multiplierBps % 10000 ? 1 : 0)}× points
                  </li>
                  {t.freeShipping && <li>Free shipping</li>}
                </ul>
                {mine && (
                  <p className="label-caps mt-3 text-[10px] text-navy">Your tier</p>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
