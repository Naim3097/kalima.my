import { Card, CardHeader } from "@/components/admin/ui";

/*
  Sync activity feed, now driven by channel_sync_log rather than a fixture.

  A Server Component. It was a client component only because the data was a
  hardcoded array in the same bundle; nothing here is interactive, so rendering
  it on the server keeps it out of the JS payload entirely.

  Level drives the dot colour, because the entries worth noticing are the ones
  that are not routine — an oversell or a failed push should be findable by
  scanning, not by reading every line.
*/

type Entry = {
  id: string;
  channel: string | null;
  level: "info" | "warning" | "error";
  event: string;
  summary: string;
  createdAt: string;
};

const DOT: Record<Entry["level"], string> = {
  info: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
};

function stamp(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" });
  if (new Date().toDateString() === d.toDateString()) return time;
  return `${d.toLocaleDateString("en-MY", { day: "numeric", month: "short" })} ${time}`;
}

export default function SyncLog({ entries }: { entries: Entry[] }) {
  return (
    <Card>
      <CardHeader title="Sync activity" />
      {entries.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13px] text-navy-300">
          Nothing yet. Activity appears here once a marketplace is connected and stock moves.
        </p>
      ) : (
        <ul className="divide-y divide-navy/5 px-5">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-3 py-3 text-[13px]">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[e.level]}`} />
              <div className="min-w-0">
                <p className="text-navy">{e.summary}</p>
                <p className="text-[11px] text-navy-300">
                  {stamp(e.createdAt)} · {e.event}
                  {e.channel ? ` · ${e.channel}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
