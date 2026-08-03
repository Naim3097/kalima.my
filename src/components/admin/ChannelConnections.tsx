"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, Pill } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { disconnectChannelAction, resyncChannel } from "@/app/admin/actions";

/*
  Connection cards, one per stock channel.

  States a card can be in, and why each is worded the way it is:
    - blocked      the adapter is not wired or has no credentials. The card says
                   which, because "no credentials" is something the client fixes
                   and "not implemented" is development work.
    - disconnected wired, but no merchant account authorised yet.
    - connected    live. Shows the shop, when it last synced, and how many
                   listings are mapped.
    - error/expired something went wrong; last_error is shown rather than hidden
                   in a log, because this card is where someone finds out they
                   need to reconnect.

  No token or expiry timestamp is passed in — see ChannelConnectionView. A
  Server Component serializes its props into the RSC payload, so anything handed
  to this component would reach the browser.
*/

type Card = {
  channel: string;
  label: string;
  status: "disconnected" | "connected" | "expired" | "error";
  shopName: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  tokenExpiringSoon: boolean;
  blockedReason: string | null;
  mappedListings: number;
};

function when(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export default function ChannelConnections({ cards }: { cards: Card[] }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  function disconnect(channel: string, label: string) {
    setBusy(channel);
    start(async () => {
      const res = await disconnectChannelAction(channel);
      setBusy(null);
      if ("error" in res) toast.error(res.error);
      else toast.success(`${label} disconnected.`);
    });
  }

  function resync(channel: string, label: string) {
    setBusy(channel);
    start(async () => {
      const res = await resyncChannel(channel);
      setBusy(null);
      if ("error" in res) toast.error(res.error);
      else toast.success(`Queued a resync of ${res.queued ?? 0} ${label} listing(s).`);
    });
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {cards.map((c) => (
        <Card key={c.channel} className="px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium text-navy">{c.label}</p>
              <p className="text-[12px] text-navy-400">
                {c.shopName ?? (c.status === "connected" ? "connected" : "not connected")}
              </p>
            </div>
            <Pill value={c.blockedReason ? "unavailable" : c.status} />
          </div>

          {c.blockedReason ? (
            <p className="mt-3 text-[12px] leading-relaxed text-navy-300">{c.blockedReason}</p>
          ) : (
            <>
              <p className="mt-3 text-[12px] text-navy-300">
                {c.mappedListings} listing{c.mappedListings === 1 ? "" : "s"} mapped · last sync{" "}
                {when(c.lastSyncAt)}
                {c.tokenExpiringSoon ? " · token expires soon" : ""}
              </p>
              {c.lastError && (
                <p className="mt-2 border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
                  {c.lastError}
                </p>
              )}
            </>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {c.blockedReason ? null : c.status === "connected" ? (
              <>
                <Button
                  variant="kalimaOutline"
                  size="editorial"
                  className="cursor-pointer border-navy/30 px-3 py-1.5"
                  disabled={pending && busy === c.channel}
                  onClick={() => resync(c.channel, c.label)}
                >
                  {pending && busy === c.channel ? "Queueing…" : "Re-sync all"}
                </Button>
                <Button
                  variant="kalimaOutline"
                  size="editorial"
                  className="cursor-pointer border-navy/30 px-3 py-1.5"
                  disabled={pending && busy === c.channel}
                  onClick={() => disconnect(c.channel, c.label)}
                >
                  Disconnect
                </Button>
              </>
            ) : (
              <a
                href={`/api/channels/${c.channel}/connect`}
                className="label-caps cursor-pointer border border-navy/30 px-3 py-1.5 text-[11px] text-navy transition-colors hover:border-navy"
              >
                Connect {c.label}
              </a>
            )}
            <a
              href={`/admin/sync/export?channel=${c.channel}`}
              className="label-caps cursor-pointer border border-navy/30 px-3 py-1.5 text-[11px] text-navy transition-colors hover:border-navy"
            >
              Export stock CSV
            </a>
          </div>
        </Card>
      ))}
    </div>
  );
}
