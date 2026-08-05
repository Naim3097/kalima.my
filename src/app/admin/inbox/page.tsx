import type { Metadata } from "next";
import { Card, CardHeader } from "@/components/admin/ui";
import InboxPanes from "@/components/admin/InboxPanes";
import ConnectWhatsApp from "@/components/admin/ConnectWhatsApp";
import { getCannedReplies, getThread, listThreads, markRead } from "@/lib/channels/inbox";
import { getChannelCards } from "@/lib/channels/admin";
import { CHANNELS, CHANNEL_LABEL, REPLY_WINDOW_HOURS, channelDoes } from "@/lib/channels/types";
import { connectBlockedReason } from "@/lib/channels/registry";

/*
  Unified Inbox — driven by the live database.

  Replaces the Phase 9 demo mock-up. No channel is connected yet, so the honest
  state of this screen today is an empty inbox plus a plain statement of which
  approval unlocks which channel. It does not pretend to have messages.

  Rendered on the server so the reply window is computed there — see
  lib/channels/reply-window. The composer must never derive it from a browser
  clock.
*/
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Inbox · Admin",
  description:
    "Shopee chat, TikTok Shop chat, Instagram DM and WhatsApp — read and replied from one place, linked to orders.",
};

const MESSAGING_CHANNELS = CHANNELS.filter((c) => channelDoes(c, "messaging"));

export default async function AdminInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;

  const [allThreads, cannedReplies, cards] = await Promise.all([
    listThreads(),
    getCannedReplies(),
    /* Messaging channels, not the stock default — see getChannelCards. */
    getChannelCards(MESSAGING_CHANNELS),
  ]);

  const activeId = c ?? allThreads[0]?.id ?? null;

  /*
    Mark read here, on the server, because a thread is open the moment this
    renders — not when someone clicks it.

    The click handler in InboxPanes could never clear the first thread, which is
    auto-selected above without any click ever happening. With a single
    conversation the badge could not be cleared at all. It was also an <a href>
    doing a full navigation, so the action it fired could be torn down before it
    reached the server even when a click did occur.

    Rendering is the honest trigger: what is on screen has been read.
  */
  if (activeId) await markRead(activeId);

  /*
    Zero it locally too. listThreads() ran before the update, so the row it
    returned still carries the old count and the badge would linger for one more
    render — the exact staleness this is meant to remove. Cheaper than
    re-querying for a number we already know.
  */
  const threads = activeId
    ? allThreads.map((t) => (t.id === activeId ? { ...t, unread: 0 } : t))
    : allThreads;

  const detail = activeId ? await getThread(activeId) : null;

  const connectedByChannel = new Map(cards.map((k) => [k.channel, k.status]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-navy">Unified Inbox ⑥</h1>
        <p className="mt-1 text-[13px] tracking-wide text-navy-400">
          Shopee chat, TikTok Shop chat, Instagram DM and WhatsApp — read and replied from one
          place, linked to orders and Kalima Club standing.
        </p>
      </div>

      <InboxPanes
        threads={threads}
        detail={detail ? { messages: detail.messages, customer: detail.customer } : null}
        activeId={activeId}
        cannedReplies={cannedReplies}
      />

      <Card>
        <CardHeader title="Channels" />
        <p className="px-5 pb-3 text-[12px] text-navy-400">
          Each channel needs its own approval before messages can arrive. WhatsApp is first: it
          shares the Meta Business verification that Phase 5 broadcasts already require, so one
          approval opens both.
        </p>
        <ul className="divide-y divide-navy/5 px-5 pb-4">
          {MESSAGING_CHANNELS.map((channel) => {
            const blocked = connectBlockedReason(channel);
            const status = connectedByChannel.get(channel);
            const hours = REPLY_WINDOW_HOURS[channel];
            return (
              <li key={channel} className="flex items-start justify-between gap-4 py-2.5 text-[13px]">
                <div>
                  <p className="text-navy">{CHANNEL_LABEL[channel]}</p>
                  <p className="text-[11px] text-navy-300">
                    {hours === null ? "No reply window" : `${hours}-hour reply window`}
                  </p>
                </div>
                <div className="flex max-w-md flex-col items-end gap-2">
                  <p className="text-right text-[12px] text-navy-300">
                    {blocked ?? (status === "connected" ? "Connected" : "Not connected")}
                  </p>
                  {/* Only WhatsApp: the others connect by OAuth, or not at all yet. */}
                  {channel === "whatsapp" && !blocked && (
                    <ConnectWhatsApp connected={status === "connected"} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-navy/10 px-5 py-3 text-[12px] leading-relaxed text-navy-400">
          TikTok <em>personal/creator</em> DMs have no public API on any platform and stay in the
          TikTok app. That does not apply to Kalima, whose TikTok is a Business account — both
          TikTok Shop buyer chat and organic DMs are covered.
        </p>
      </Card>
    </div>
  );
}
