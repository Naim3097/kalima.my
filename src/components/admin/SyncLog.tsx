"use client";

import { Card, CardHeader } from "@/components/admin/ui";
import { SYNC_LOG } from "@/data/demo";

/*
  Sync activity feed. Below the fold on the Marketplace Sync screen, so the
  page lazy-loads it via next/dynamic behind a Skeleton.
*/
export default function SyncLog() {
  return (
    <Card>
      <CardHeader title="Sync activity — today" />
      <ul className="divide-y divide-navy/5 px-5">
        {SYNC_LOG.map((l) => (
          <li key={l.time + l.event} className="flex items-start gap-3 py-3 text-[13px]">
            <span
              className={`mt-1 h-2 w-2 shrink-0 rounded-full ${l.ok ? "bg-emerald-500" : "bg-red-500"}`}
            />
            <div>
              <p className="text-navy">{l.event}</p>
              <p className="text-[11px] text-navy-300">{l.time}</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
