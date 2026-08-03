import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatRM } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { getCurrentUser } from "@/lib/auth";
import { fetchMyOrders } from "@/lib/commerce";
import { getMyClub } from "@/lib/loyalty";
import { courierName, trackingLink } from "@/lib/couriers";
import { signOut } from "@/app/auth/actions";
import ChangePasswordForm from "@/components/account/ChangePasswordForm";

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "Pending payment",
  paid: "Paid — preparing",
  fulfilled: "Shipped",
  completed: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export const metadata: Metadata = {
  title: "My Account",
  description:
    "Your Kalima Club dashboard — points balance, tier progress, order history and saved details.",
};

/*
  Server Component, entirely on real data: session identity, the Kalima Club
  standing from the loyalty ledger, and order history with tracking.

  The Club card previously showed a hardcoded "Gold Member · 1,250 points" and a
  fabricated points history, while the badge above it claimed orders were demo
  too — which they had not been since Phase 2. Inventing a balance on a page a
  customer reads as their own account is worse than showing nothing: points are
  a liability the shop owes them, and a wrong number is a promise it did not
  make.

  Tier, balance and progress all come from getMyClub, the same read model
  /kalima-club uses, so the two pages cannot disagree about what someone is
  owed.
*/
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ password?: string }>;
}) {
  const current = await getCurrentUser();
  // The proxy already gates /account, but never assume the edge ran.
  if (!current) redirect("/login?next=/account");

  const { password } = await searchParams;
  const { user, profile } = current;
  const [orders, club] = await Promise.all([fetchMyOrders(), getMyClub()]);
  const displayName = profile?.full_name?.trim() || user.email?.split("@")[0] || "there";
  const profileLine = [
    profile?.full_name,
    user.email,
    profile?.phone,
    `WhatsApp updates ${profile?.marketing_consent ? "ON" : "OFF"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      {password === "changed" && (
        <p className="mb-6 border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
          Your password has been updated.
        </p>
      )}

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-caps text-navy-400">My Account</p>
          <h1 className="mt-1 font-display text-4xl text-navy">Salam, {displayName}</h1>
        </div>
        <div className="flex items-center gap-3">
          <form action={signOut}>
            <button
              type="submit"
              className="label-caps cursor-pointer border border-navy/30 px-4 py-1.5 text-navy transition-colors hover:border-navy"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>

      {/* Kalima Club — from the loyalty ledger */}
      {club && (
        <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="bg-navy p-8 text-white">
            <div className="flex items-start justify-between">
              <div>
                <p className="label-caps text-white/60">Kalima Club</p>
                <p className="mt-2 font-display text-3xl">{club.tier.name}</p>
              </div>
              <Image
                src="/brand/kalima-mark-white.png"
                alt=""
                width={48}
                height={48}
                className="h-12 w-auto opacity-80"
              />
            </div>
            <div className="mt-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="label-caps text-white/60">Points balance</p>
                <p className="mt-1 font-display text-4xl">{club.balance.toLocaleString("en-MY")}</p>
                <p className="mt-1 text-[12px] tracking-wide text-white/50">
                  = {formatRM(club.valueSen / 100)} off your next order
                </p>
              </div>
              <div className="text-right text-[12px] tracking-wide text-white/60">
                <p>
                  {(club.tier.multiplierBps / 10000).toFixed(
                    club.tier.multiplierBps % 10000 ? 1 : 0,
                  )}
                  × points on every order
                </p>
                {club.tier.freeShipping && <p>Free shipping, always</p>}
              </div>
            </div>

            {/* Only shown when there is a next tier to reach. */}
            {club.nextTier && (
              <div className="mt-8">
                <div className="mb-1.5 flex justify-between text-[12px] tracking-wide text-white/60">
                  <span>Progress to {club.nextTier.name}</span>
                  <span>
                    {formatRM(club.spend12mSen / 100)} / {formatRM(club.nextTier.minSpendSen / 100)}
                  </span>
                </div>
                <Progress
                  value={Math.min(
                    100,
                    club.nextTier.minSpendSen > 0
                      ? Math.round((club.spend12mSen / club.nextTier.minSpendSen) * 100)
                      : 100,
                  )}
                  aria-label={`Progress to ${club.nextTier.name} tier`}
                  className="h-1.5 rounded-none bg-white/15 *:data-[slot=progress-indicator]:bg-white"
                />
                <p className="mt-2 text-[12px] tracking-wide text-white/50">
                  {formatRM(club.toNextTierSen / 100)} more in the next 12 months unlocks{" "}
                  {club.nextTier.name}
                </p>
              </div>
            )}
          </div>

          {/* Points activity — the real ledger */}
          <div className="border border-navy/10 bg-white">
            <div className="border-b border-navy/10 px-5 py-4">
              <h2 className="label-caps !text-[12px]">Points activity</h2>
            </div>
            {club.entries.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-navy-300">
                No points yet — they are credited once an order is delivered.
              </p>
            ) : (
              <ul className="divide-y divide-navy/5 px-5">
                {club.entries.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between gap-4 py-3.5 text-[13px]"
                  >
                    <div>
                      <p className="text-navy">{e.reason ?? e.type}</p>
                      <p className="text-[11px] text-navy-300">
                        {new Date(e.createdAt).toLocaleDateString("en-MY", {
                          day: "numeric",
                          month: "short",
                        })}
                      </p>
                    </div>
                    <span className={e.points > 0 ? "text-emerald-700" : "text-navy-400"}>
                      {e.points > 0 ? "+" : "−"}
                      {Math.abs(e.points)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* Orders — real */}
      <section className="mt-10">
        <h2 className="label-caps mb-4 !text-[13px]">Order History</h2>
        {orders.length === 0 ? (
          <div className="border border-navy/10 bg-white px-5 py-10 text-center">
            <p className="text-[14px] text-navy-400">No orders yet.</p>
            <div className="mt-4">
              <Link href="/collections/best-sellers" className="link-editorial text-navy">
                Shop best sellers
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => {
              const itemsLine = o.items
                .map((i) => `${i.product_name} (${i.size}) × ${i.qty}`)
                .join(", ");
              const delivered = o.status === "completed" || o.status === "fulfilled";
              // The first parcel with a usable tracking link — customers care
              // about "where is it", not about our shipment rows.
              const tracked = o.shipments
                .map((sh) => ({
                  ...sh,
                  href: trackingLink(sh.courier, sh.tracking_no, sh.tracking_url),
                }))
                .find((sh) => sh.href);
              return (
                <div key={o.reference} className="flex flex-wrap items-center justify-between gap-4 border border-navy/10 bg-white px-5 py-4">
                  <div>
                    <p className="text-[14px] font-medium text-navy">{o.reference}</p>
                    <p className="mt-0.5 text-[12px] tracking-wide text-navy-400">
                      {new Date(o.created_at).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}
                      {itemsLine && ` · ${itemsLine}`}
                    </p>
                    {tracked && (
                      <p className="mt-1 text-[12px] tracking-wide">
                        <a
                          href={tracked.href as string}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-navy underline underline-offset-2 hover:text-navy-400"
                        >
                          Track parcel
                        </a>
                        <span className="text-navy-400">
                          {" "}· {courierName(tracked.courier) ?? "Courier"}
                          {tracked.tracking_no ? ` ${tracked.tracking_no}` : ""}
                        </span>
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-6">
                    <span className="text-[14px] text-navy">{formatRM(o.total_sen / 100)}</span>
                    <Badge
                      variant="ghost"
                      className={`rounded-full px-3 py-1 text-[10px] font-normal uppercase tracking-wider ${
                        delivered ? "bg-emerald-100 text-emerald-900" : "bg-navy-100 text-navy"
                      }`}
                    >
                      {ORDER_STATUS_LABEL[o.status] ?? o.status}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Saved details */}
      <section className="mt-10 grid gap-4 md:grid-cols-2">
        <div className="border border-navy/10 bg-white px-5 py-4">
          <h3 className="label-caps !text-[12px]">Profile</h3>
          <p className="mt-2 text-[13px] leading-relaxed tracking-wide text-navy-400">
            {profileLine}
          </p>
        </div>
        {/*
          Address book and marketing preferences are not built. They were
          previously rendered as a fabricated Shah Alam address and an invented
          membership date, each with an Edit button that did nothing — three
          untruths on the page a customer trusts most about their own data.
          Saying so plainly is the honest placeholder.
        */}
        <div className="border border-navy/10 bg-white px-5 py-4">
          <h3 className="label-caps !text-[12px]">Saved addresses</h3>
          <p className="mt-2 text-[13px] leading-relaxed tracking-wide text-navy-400">
            Your delivery address is taken at checkout each time. A saved address book is on the
            way.
          </p>
        </div>
      </section>

      {/* Security — real */}
      <section className="mt-10">
        <div className="border border-navy/10 bg-white px-5 py-5">
          <h3 className="label-caps !text-[12px]">Security</h3>
          <p className="mt-2 mb-4 text-[13px] leading-relaxed tracking-wide text-navy-400">
            Change your password. You&apos;ll need your current one.
          </p>
          <ChangePasswordForm />
        </div>
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
