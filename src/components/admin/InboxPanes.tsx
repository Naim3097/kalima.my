"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CONVERSATIONS, INBOX_CHANNEL_META, type InboxChannel } from "@/data/demo";

/*
  Unified inbox — channel filter, conversation list, thread and reply
  composer. The whole block is stateful, so it lives behind a single client
  boundary that the page lazy-loads.
*/
const QUICK_REPLIES = ["Order status 📦", "Size guide 📏", "Restock alert 🔔"];

export default function InboxPanes() {
  const [activeId, setActiveId] = useState(CONVERSATIONS[0].id);
  const [filter, setFilter] = useState<InboxChannel | "all">("all");
  const [draft, setDraft] = useState("");

  const list = CONVERSATIONS.filter((c) => filter === "all" || c.channel === filter);
  const active = CONVERSATIONS.find((c) => c.id === activeId) ?? CONVERSATIONS[0];
  const activeMeta = INBOX_CHANNEL_META[active.channel];

  return (
    <>
      {/* Channel filter */}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => setFilter("all")}
          variant={filter === "all" ? "kalima" : "kalimaOutline"}
          size="editorial"
          className={`cursor-pointer px-4 py-2 transition-colors ${
            filter === "all" ? "" : "border-navy/20 text-navy-400 hover:text-navy"
          }`}
        >
          All ({CONVERSATIONS.length})
        </Button>
        {(Object.keys(INBOX_CHANNEL_META) as InboxChannel[]).map((ch) => (
          <Button
            key={ch}
            onClick={() => setFilter(ch)}
            variant={filter === ch ? "kalima" : "kalimaOutline"}
            size="editorial"
            className={`cursor-pointer px-4 py-2 transition-colors ${
              filter === ch ? "" : "border-navy/20 text-navy-400 hover:text-navy"
            }`}
          >
            {INBOX_CHANNEL_META[ch].label}
          </Button>
        ))}
      </div>

      <Card className="grid min-h-[480px] xl:grid-cols-[300px_1fr_260px]">
        {/* Conversation list */}
        <div className="border-b border-navy/10 xl:border-b-0 xl:border-r">
          <ul className="divide-y divide-navy/5">
            {list.map((c) => {
              const meta = INBOX_CHANNEL_META[c.channel];
              return (
                <li key={c.id}>
                  <button
                    onClick={() => setActiveId(c.id)}
                    className={`w-full cursor-pointer px-4 py-3.5 text-left transition-colors ${
                      c.id === active.id ? "bg-cream-50" : "hover:bg-cream-50/60"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-[13px] font-medium text-navy">
                        <span className="h-2 w-2 rounded-full" style={{ background: meta.color }} />
                        {c.customer}
                      </span>
                      <span className="text-[11px] text-navy-300">{c.time}</span>
                    </div>
                    <p
                      className={`mt-1 truncate text-[12px] ${
                        c.unread ? "font-medium text-navy" : "text-navy-400"
                      }`}
                    >
                      {c.preview}
                    </p>
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-navy-300">{meta.label}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Thread */}
        <div className="flex flex-col border-b border-navy/10 xl:border-b-0 xl:border-r">
          <div className="flex items-center justify-between border-b border-navy/10 px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: activeMeta.color }} />
              <span className="text-[14px] font-medium text-navy">{active.customer}</span>
              <Badge
                variant="ghost"
                className="rounded border-0 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white"
                style={{ background: activeMeta.color }}
              >
                {activeMeta.label}
              </Badge>
            </div>
            <Button
              variant="ghost"
              className="label-caps h-auto cursor-pointer p-0 text-navy-400 transition-colors hover:bg-transparent hover:text-navy"
            >
              Assign
            </Button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
            {active.messages.map((m, i) => (
              <div key={i} className={`flex ${m.from === "kalima" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[75%] rounded-lg px-4 py-2.5 text-[13px] leading-relaxed ${
                    m.from === "kalima"
                      ? "rounded-br-none bg-navy text-white"
                      : "rounded-bl-none bg-navy-100 text-navy"
                  }`}
                >
                  {m.text}
                  <p className={`mt-1 text-[10px] ${m.from === "kalima" ? "text-white/50" : "text-navy-300"}`}>
                    {m.time}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-navy/10 p-4">
            <div className="flex gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Reply on ${activeMeta.label}…`}
                className="h-auto flex-1 border-navy/20 bg-cream-50 px-4 py-2.5 text-[13px] text-navy shadow-none placeholder:text-navy-300 focus-visible:border-navy focus-visible:ring-0 md:text-[13px]"
              />
              <Button
                variant="kalima"
                size="editorial"
                className="cursor-pointer px-5 py-0 transition-colors"
              >
                Send
              </Button>
            </div>
            <div className="mt-2.5 flex gap-2">
              {QUICK_REPLIES.map((quick) => (
                <button
                  key={quick}
                  onClick={() => setDraft(quick)}
                  className="cursor-pointer rounded-full border border-navy/15 px-3 py-1 text-[11px] tracking-wide text-navy-400 transition-colors hover:border-navy hover:text-navy"
                >
                  {quick}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Customer context */}
        <div className="px-5 py-5">
          <p className="label-caps mb-4 text-navy-400">Customer context</p>
          <p className="text-[14px] font-medium text-navy">{active.customer}</p>
          {active.linkedOrder ? (
            <div className="mt-4 border border-navy/10 bg-cream-50 px-4 py-3">
              <p className="label-caps text-navy-400">Linked order</p>
              <p className="mt-1 text-[13px] font-medium text-navy">{active.linkedOrder}</p>
              <p className="mt-0.5 text-[12px] text-navy-400">Auto-matched by buyer ID</p>
              <Link
                href="/admin/orders"
                className="mt-2 inline-block text-[12px] text-navy underline underline-offset-4"
              >
                Open order →
              </Link>
            </div>
          ) : (
            <p className="mt-4 text-[12px] leading-relaxed text-navy-300">
              No linked order yet — will auto-link when this buyer purchases.
            </p>
          )}
          <div className="mt-4 space-y-2 text-[12px] text-navy-400">
            <p>First contact: 2 May 2026</p>
            <p>Conversations: 3</p>
            <p>Avg response time: 11 min</p>
          </div>
        </div>
      </Card>
    </>
  );
}
