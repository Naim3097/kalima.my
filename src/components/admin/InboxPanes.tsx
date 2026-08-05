"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { formatRM } from "@/lib/format";
import { addInboxNote, sendInboxReply, updateConversation } from "@/app/admin/actions";

/*
  Unified inbox — channel filter, thread list, conversation and composer.

  THE COMPOSER READS A SERVER-COMPUTED WINDOW. `thread.window` arrives already
  decided by lib/channels/reply-window on the server; nothing here recomputes it
  from a timestamp. A client-side timer would drift, would be wrong on a tab left
  open overnight, and would be editable by anyone with dev tools — and the
  failure it causes is the expensive one: a reply that looks sent and never
  arrives.

  The send action re-derives the window server-side anyway, so this is a courtesy
  to staff rather than the enforcement point. Enforcement lives where it cannot
  be bypassed.
*/

type Win = { open: boolean; hoursLeft: number | null; reason: string | null };

type Thread = {
  id: string;
  channel: string;
  channelLabel: string;
  handle: string;
  preview: string;
  lastMessageAt: string | null;
  unread: number;
  status: "open" | "snoozed" | "closed";
  customerId: string | null;
  window: Win;
};

type Message = {
  id: string;
  direction: "inbound" | "outbound" | "note";
  body: string | null;
  sentAt: string;
  delivery: string;
  deliveryError: string | null;
};

type Customer = {
  name: string | null;
  phone: string | null;
  orders: { reference: string; status: string; totalSen: number; createdAt: string }[];
  loyaltyPoints: number | null;
  tier: string | null;
};

type Detail = { messages: Message[]; customer: Customer | null } | null;

const CHANNEL_COLOR: Record<string, string> = {
  shopee: "#ee4d2d",
  tiktok: "#161823",
  instagram: "#c13584",
  whatsapp: "#25d366",
  facebook: "#1877f2",
};

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date().toDateString() === d.toDateString()
    ? d.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-MY", { day: "numeric", month: "short" });
}

export default function InboxPanes({
  threads,
  detail,
  activeId,
  cannedReplies,
}: {
  threads: Thread[];
  detail: Detail;
  activeId: string | null;
  cannedReplies: { id: string; title: string; body: string }[];
}) {
  const [filter, setFilter] = useState<string>("all");
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [pending, start] = useTransition();

  const list = useMemo(
    () => threads.filter((t) => filter === "all" || t.channel === filter),
    [threads, filter],
  );
  const active = threads.find((t) => t.id === activeId) ?? null;
  const channels = useMemo(() => Array.from(new Set(threads.map((t) => t.channel))), [threads]);

  function submit() {
    if (!active) return;
    const body = draft.trim();
    if (!body) return;
    start(async () => {
      const res =
        mode === "note"
          ? await addInboxNote(active.id, body)
          : await sendInboxReply(active.id, body);
      if ("error" in res) toast.error(res.error);
      else {
        toast.success(mode === "note" ? "Note added." : "Reply sent.");
        setDraft("");
      }
    });
  }

  function setStatus(status: "open" | "snoozed" | "closed") {
    if (!active) return;
    start(async () => {
      const res = await updateConversation({ conversationId: active.id, status });
      if ("error" in res) toast.error(res.error);
      else toast.success(`Conversation ${status}.`);
    });
  }

  if (threads.length === 0) {
    return (
      <div className="border border-navy/10 bg-white px-6 py-16 text-center">
        <p className="font-display text-xl text-navy">No conversations yet</p>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-navy-400">
          Messages appear here once a channel is connected. WhatsApp comes first — it shares the
          Meta Business verification that Phase 5 broadcasts already need, so one approval opens
          both.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter("all")}
          className={`label-caps cursor-pointer border px-3 py-1.5 text-[10px] transition-colors ${
            filter === "all" ? "border-navy bg-navy text-white" : "border-navy/30 text-navy"
          }`}
        >
          All ({threads.length})
        </button>
        {channels.map((c) => {
          const n = threads.filter((t) => t.channel === c).length;
          return (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`label-caps cursor-pointer border px-3 py-1.5 text-[10px] transition-colors ${
                filter === c ? "border-navy bg-navy text-white" : "border-navy/30 text-navy"
              }`}
            >
              <span
                className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                style={{ background: CHANNEL_COLOR[c] ?? "#888" }}
              />
              {threads.find((t) => t.channel === c)?.channelLabel ?? c} ({n})
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 lg:grid-cols-[300px_1fr_260px]">
        {/* Thread list */}
        <ul className="max-h-[560px] divide-y divide-navy/5 overflow-y-auto border border-navy/10 bg-white">
          {list.map((t) => (
            <li key={t.id}>
              <a
                /* Not marked read here: navigating away can kill the action
                   mid-flight, and it never fired for the auto-selected thread.
                   The server does it on render — see admin/inbox/page.tsx. */
                href={`/admin/inbox?c=${t.id}`}
                className={`block cursor-pointer px-4 py-3 text-left transition-colors hover:bg-cream-50 ${
                  t.id === activeId ? "bg-cream-50" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 truncate text-[13px] font-medium text-navy">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: CHANNEL_COLOR[t.channel] ?? "#888" }}
                    />
                    {t.handle}
                  </span>
                  <span className="shrink-0 text-[11px] text-navy-300">{when(t.lastMessageAt)}</span>
                </div>
                <p className="mt-1 truncate text-[12px] text-navy-400">{t.preview}</p>
                <div className="mt-1 flex items-center gap-2">
                  {t.unread > 0 && (
                    <span className="rounded-full bg-navy px-2 py-0.5 text-[10px] text-white">
                      {t.unread}
                    </span>
                  )}
                  {!t.window.open && <span className="text-[10px] text-amber-700">window closed</span>}
                  {t.status !== "open" && (
                    <span className="text-[10px] text-navy-300">{t.status}</span>
                  )}
                </div>
              </a>
            </li>
          ))}
        </ul>

        {/* Thread + composer */}
        <div className="flex max-h-[560px] flex-col border border-navy/10 bg-white">
          {!active || !detail ? (
            <p className="p-8 text-center text-[13px] text-navy-300">Select a conversation.</p>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-navy/10 px-4 py-3">
                <div>
                  <p className="text-[13px] font-medium text-navy">{active.handle}</p>
                  <p className="text-[11px] text-navy-300">
                    {active.channelLabel}
                    {active.window.open && active.window.hoursLeft !== null
                      ? ` · ${active.window.hoursLeft}h left to reply`
                      : ""}
                  </p>
                </div>
                <div className="flex gap-1">
                  {(["open", "snoozed", "closed"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatus(s)}
                      disabled={pending}
                      className={`label-caps cursor-pointer border px-2 py-1 text-[9px] transition-colors ${
                        active.status === s
                          ? "border-navy bg-navy text-white"
                          : "border-navy/25 text-navy-400"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {detail.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.direction === "inbound" ? "justify-start" : "justify-end"}`}
                  >
                    <div
                      className={`max-w-[75%] px-3 py-2 text-[13px] ${
                        m.direction === "note"
                          ? "border border-amber-200 bg-amber-50 text-amber-900"
                          : m.direction === "inbound"
                            ? "bg-cream-100 text-navy"
                            : "bg-navy text-white"
                      }`}
                    >
                      {m.direction === "note" && (
                        <p className="label-caps mb-1 !text-[9px] opacity-70">Internal note</p>
                      )}
                      <p className="whitespace-pre-wrap">{m.body}</p>
                      <p
                        className={`mt-1 text-[10px] ${
                          m.direction === "outbound" ? "text-white/60" : "text-navy-300"
                        }`}
                      >
                        {when(m.sentAt)}
                        {m.direction === "outbound" && m.delivery !== "delivered"
                          ? ` · ${m.delivery}`
                          : ""}
                      </p>
                      {m.deliveryError && (
                        <p className="mt-1 text-[10px] text-red-300">{m.deliveryError}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-navy/10 p-3">
                <div className="mb-2 flex items-center gap-2">
                  {(["reply", "note"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      className={`label-caps cursor-pointer border px-2 py-1 text-[9px] transition-colors ${
                        mode === m ? "border-navy bg-navy text-white" : "border-navy/25 text-navy-400"
                      }`}
                    >
                      {m === "reply" ? "Reply" : "Internal note"}
                    </button>
                  ))}
                  {cannedReplies.length > 0 && mode === "reply" && active.window.open && (
                    <select
                      value=""
                      onChange={(e) => {
                        const r = cannedReplies.find((c) => c.id === e.target.value);
                        if (r) setDraft(r.body);
                      }}
                      className="cursor-pointer border border-navy/20 bg-white px-2 py-1 text-[11px] text-navy"
                    >
                      <option value="">Quick reply…</option>
                      {cannedReplies.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Courtesy, not enforcement — the server decides again on send. */}
                {mode === "reply" && !active.window.open ? (
                  <p className="border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-900">
                    {active.window.reason}
                    <span className="mt-1 block text-amber-800/80">
                      An internal note can still be added.
                    </span>
                  </p>
                ) : (
                  <div className="flex gap-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={2}
                      placeholder={
                        mode === "note"
                          ? "Internal note — never sent to the customer"
                          : `Reply on ${active.channelLabel}…`
                      }
                      className="flex-1 resize-none border border-navy/20 px-3 py-2 text-[13px] text-navy"
                    />
                    <button
                      onClick={submit}
                      disabled={pending || !draft.trim()}
                      className="label-caps cursor-pointer self-end border border-navy bg-navy px-4 py-2 text-[10px] text-white disabled:opacity-40"
                    >
                      {pending ? "…" : mode === "note" ? "Add" : "Send"}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Customer context — the reason this beats four browser tabs */}
        <div className="max-h-[560px] overflow-y-auto border border-navy/10 bg-white p-4">
          {!detail?.customer ? (
            <p className="text-[12px] leading-relaxed text-navy-300">
              {active
                ? "Not matched to a customer account. Linking happens on first contact, by phone or email."
                : "Customer details appear here."}
            </p>
          ) : (
            <div className="space-y-4 text-[13px]">
              <div>
                <p className="label-caps !text-[10px] text-navy-400">Customer</p>
                <p className="mt-1 font-medium text-navy">{detail.customer.name ?? "—"}</p>
                {detail.customer.phone && (
                  <p className="text-[12px] text-navy-300">{detail.customer.phone}</p>
                )}
              </div>
              <div>
                <p className="label-caps !text-[10px] text-navy-400">Kalima Club</p>
                <p className="mt-1 text-navy">
                  {detail.customer.loyaltyPoints ?? 0} points
                  {detail.customer.tier ? ` · ${detail.customer.tier}` : ""}
                </p>
              </div>
              <div>
                <p className="label-caps !text-[10px] text-navy-400">Recent orders</p>
                {detail.customer.orders.length === 0 ? (
                  <p className="mt-1 text-[12px] text-navy-300">None yet</p>
                ) : (
                  <ul className="mt-1 space-y-1.5">
                    {detail.customer.orders.map((o) => (
                      <li key={o.reference} className="flex items-center justify-between gap-2">
                        <a
                          href={`/admin/orders/${o.reference}`}
                          className="truncate text-[12px] text-navy underline underline-offset-2"
                        >
                          {o.reference}
                        </a>
                        <span className="shrink-0 text-[11px] text-navy-300">
                          {formatRM(o.totalSen / 100)} · {o.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
