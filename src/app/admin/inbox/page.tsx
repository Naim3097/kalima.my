import type { Metadata } from "next";
import { Card, CardHeader } from "@/components/admin/ui";
import InboxPanes from "@/components/admin/InboxPanes";
import ConnectChannel from "@/components/admin/ConnectChannel";
import SyncTemplates from "@/components/admin/SyncTemplates";
import TemplateList from "@/components/admin/TemplateList";
import AutomaticMessages from "@/components/admin/AutomaticMessages";
import { AUTOMATION_EVENTS, getAutomations, type AutomationSetting } from "@/lib/messaging/whatsapp-automations";
import { getCannedReplies, getThread, listThreads, markRead } from "@/lib/channels/inbox";
import { getChannelCards } from "@/lib/channels/admin";
import {
  CHANNELS,
  CHANNEL_LABEL,
  REPLY_WINDOW_HOURS,
  channelDoes,
  isMetaMessagingChannel,
} from "@/lib/channels/types";
import { connectBlockedReason } from "@/lib/channels/registry";
import {
  listSendableTemplates,
  listWhatsAppTemplates,
  templatesBlockedReason,
  type WhatsAppTemplate,
} from "@/lib/channels/whatsapp-templates";

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

/*
  Templates, loaded so a failure cannot take the inbox with it.

  Every other read on this page is load-bearing: without threads there is no
  inbox. Templates are additive — they add one composer mode to one channel —
  so a missing table (the window between this deploying and its migration being
  applied) or a database hiccup must degrade to "templates unavailable" rather
  than to a 500 that stops staff answering customers.

  The reason is carried through to the composer, so the degradation is stated
  rather than presented as "this WhatsApp number has no templates".
*/
async function loadTemplates(): Promise<{
  /* Sendable only — what the composer may offer. */
  list: WhatsAppTemplate[];
  /* Everything synced, approved or not. The unapproved ones are the whole
     point of the panel: without them, a template Meta refused is invisible. */
  all: WhatsAppTemplate[];
  blocked: string | null;
}> {
  const blocked = templatesBlockedReason();
  if (blocked) return { list: [], all: [], blocked };
  try {
    const [list, all] = await Promise.all([listSendableTemplates(), listWhatsAppTemplates()]);
    return { list, all, blocked: null };
  } catch (e) {
    return {
      list: [],
      all: [],
      blocked: `Templates could not be loaded: ${
        e instanceof Error ? e.message : "unknown error"
      }`,
    };
  }
}

export default async function AdminInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;

  const [allThreads, cannedReplies, cards, templates, automations] = await Promise.all([
    listThreads(),
    getCannedReplies(),
    /* Messaging channels, not the stock default — see getChannelCards. */
    getChannelCards(MESSAGING_CHANNELS),
    loadTemplates(),
    /* Additive, like templates: a missing table must not take the inbox down. */
    getAutomations().catch((): AutomationSetting[] => []),
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
        templates={templates.list}
        templatesBlocked={templates.blocked}
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
                  {/*
                    Every Meta channel, not just WhatsApp: all three take a token
                    from the environment rather than an OAuth round trip, so all
                    three connect the same way. Shopee and TikTok are excluded
                    because they genuinely do go through OAuth.
                  */}
                  {isMetaMessagingChannel(channel) && !blocked && (
                    <ConnectChannel
                      channel={channel}
                      label={CHANNEL_LABEL[channel]}
                      connected={status === "connected"}
                    />
                  )}
                  {/*
                    WhatsApp only: templates are a WhatsApp construct, and this
                    is the row someone is already looking at when they wonder
                    whether Meta has approved one yet.

                    Shown only once the channel is actually connected — before
                    that the blocker is the connection, and a second button
                    offering to sync a registry we cannot reach would just be a
                    second way to see the same error.
                  */}
                  {channel === "whatsapp" && !blocked && status === "connected" && (
                    <SyncTemplates count={templates.list.length} />
                  )}
                  {channel === "whatsapp" && !blocked && templates.blocked && (
                    <p className="text-right text-[11px] leading-relaxed text-amber-700">
                      {templates.blocked}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {/*
          Template status, shown only once WhatsApp is connected — before that
          the blocker is the connection, and an empty template panel would just
          be a second place reporting the same thing.
        */}
        {templates.all.length > 0 && (
          <div className="border-t border-navy/10 px-5 py-4">
            <p className="label-caps mb-1 text-[10px] text-navy-400">WhatsApp templates</p>
            <p className="mb-2 text-[12px] leading-relaxed text-navy-400">
              Written and submitted in Meta Business Manager; synced here. Only approved ones
              appear in the composer.
            </p>
            <TemplateList templates={templates.all} />
          </div>
        )}
        {/*
          Transactional sends — which approved template fires when an order is
          paid, shipped, delivered. Shown whenever WhatsApp is connected, even
          with no templates yet, because the value list beside each event is
          what someone needs to see BEFORE writing the template at Meta.
        */}
        {connectedByChannel.get("whatsapp") === "connected" && !templates.blocked && automations.length > 0 && (
          <div className="border-t border-navy/10 px-5 py-4">
            <p className="label-caps mb-1 text-[10px] text-navy-400">Automatic messages</p>
            <p className="mb-2 text-[12px] leading-relaxed text-navy-400">
              Order updates sent on WhatsApp without anyone pressing send. Write the template at
              Meta using the numbered values listed for the event, sync, then pick it here. A
              customer who has replied STOP is never messaged.
            </p>
            <AutomaticMessages events={AUTOMATION_EVENTS} settings={automations} templates={templates.all} />
          </div>
        )}

        <p className="border-t border-navy/10 px-5 py-3 text-[12px] leading-relaxed text-navy-400">
          TikTok <em>personal/creator</em> DMs have no public API on any platform and stay in the
          TikTok app. That does not apply to Kalima, whose TikTok is a Business account — both
          TikTok Shop buyer chat and organic DMs are covered.
        </p>
      </Card>
    </div>
  );
}
