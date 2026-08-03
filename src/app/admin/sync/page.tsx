import type { Metadata } from "next";
import { Card, CardHeader, StatCard } from "@/components/admin/ui";
import ChannelConnections from "@/components/admin/ChannelConnections";
import ListingMapper from "@/components/admin/ListingMapper";
import SyncLog from "@/components/admin/SyncLog";
import {
  getChannelCards,
  getChannelOrders,
  getSyncActivity,
  getSyncHealth,
  getSyncRows,
  STOCK_CHANNELS,
} from "@/lib/channels/admin";
import { CHANNEL_LABEL } from "@/lib/channels/types";
import { formatRM } from "@/lib/format";

/*
  Marketplace Sync — driven by the live database.

  Replaces the Phase 8 demo mock-up, whose numbers were hardcoded ("312 SKUs
  checked, 0 drift").

  What is honest about this screen while the platform approvals are outstanding:
  the connection cards say plainly that an adapter is not wired, and the CSV
  export/import pair is offered as the workflow that actually works today. It
  does not imply an automatic sync that cannot run yet.
*/
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sync · Admin",
  description:
    "One stock pool across kalima.my, Shopee and TikTok Shop — a sale anywhere updates everywhere.",
};

export default async function AdminSyncPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { connected, error } = await searchParams;

  const [cards, rows, health, activity, orders] = await Promise.all([
    getChannelCards(),
    getSyncRows(),
    getSyncHealth(),
    getSyncActivity(40),
    getChannelOrders(15),
  ]);

  const channels = STOCK_CHANNELS.map((c) => ({ key: c, label: CHANNEL_LABEL[c] }));
  const mapped = rows.reduce(
    (n, r) => n + channels.filter((c) => r.listings[c.key as keyof typeof r.listings]).length,
    0,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-navy">Marketplace Sync ⑤</h1>
        <p className="mt-1 text-[13px] tracking-wide text-navy-400">
          One stock pool across kalima.my, Shopee and TikTok Shop — a sale anywhere updates
          everywhere, no more oversell.
        </p>
      </div>

      {connected && (
        <p className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
          {connected}
        </p>
      )}
      {error && (
        <p className="border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">{error}</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Listings mapped" value={String(mapped)} sub={`${rows.length} variants`} />
        <StatCard
          label="Not fully mapped"
          value={String(health.unmappedVariants)}
          sub="variants missing a channel"
          accent={health.unmappedVariants > 0 ? "down" : undefined}
        />
        <StatCard label="Queued pushes" value={String(health.queued)} sub={`${health.running} running`} />
        <StatCard
          label="Failed jobs"
          value={String(health.failed)}
          sub="after 6 attempts"
          accent={health.failed > 0 ? "down" : undefined}
        />
      </div>

      <ChannelConnections cards={cards} />

      <ListingMapper rows={rows} channels={channels} />

      {health.unmappedFromOrders.length > 0 && (
        <Card>
          <CardHeader title="Unmapped listings seen in marketplace orders" />
          <p className="px-5 pb-3 text-[12px] text-navy-400">
            These sold on a marketplace but are not mapped to a variant here, so their stock was not
            deducted. Map them above and the next sale will reconcile.
          </p>
          <ul className="divide-y divide-navy/5 px-5 pb-4">
            {health.unmappedFromOrders.map((u) => (
              <li
                key={`${u.channel}-${u.externalItemId}-${u.externalModelId ?? ""}`}
                className="flex items-center justify-between py-2.5 text-[13px]"
              >
                <code className="rounded bg-navy-100 px-2 py-1 text-[11px]">
                  {u.externalItemId}
                  {u.externalModelId ? `/${u.externalModelId}` : ""}
                </code>
                <span className="text-navy-300">
                  {CHANNEL_LABEL[u.channel]} · seen in {u.seen} order{u.seen === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {orders.length > 0 && (
        <Card>
          <CardHeader title="Recent marketplace orders" />
          <p className="px-5 pb-3 text-[12px] text-navy-400">
            Imported for stock and visibility only — fulfilment and refunds stay in the seller
            centre, which both platforms require.
          </p>
          <ul className="divide-y divide-navy/5 px-5 pb-4">
            {orders.map((o) => (
              <li key={o.id} className="flex items-center justify-between py-2.5 text-[13px]">
                <div>
                  <code className="rounded bg-navy-100 px-2 py-1 text-[11px]">
                    {o.externalOrderId}
                  </code>
                  <span className="ml-2 text-navy-300">
                    {CHANNEL_LABEL[o.channel]} · {o.lines} line{o.lines === 1 ? "" : "s"}
                    {o.buyerName ? ` · ${o.buyerName}` : ""}
                  </span>
                </div>
                <span className="text-navy">
                  {o.totalSen == null ? "—" : formatRM(o.totalSen / 100)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <SyncLog entries={activity} />
    </div>
  );
}
