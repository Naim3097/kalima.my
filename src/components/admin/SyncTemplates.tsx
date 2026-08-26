"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { syncWhatsAppTemplatesNow } from "@/app/admin/actions";

/*
  Pulls Meta's template registry into the local cache.

  A button and not a schedule, deliberately. Approval takes anywhere from
  minutes to days and Meta gives no notice when it lands, so the moment a
  refresh is actually worth making is the moment someone is looking at this
  screen wondering whether it came through. A cron would either poll a rarely
  changing list constantly, or still be stale at exactly the moment it mattered.

  The count is reported rather than a bare "Synced", because the number is the
  answer to the question that prompted the press: approved is what the composer
  will offer, and if it is still zero the template is still in review.
*/
export default function SyncTemplates({ count }: { count: number }) {
  const [pending, start] = useTransition();

  function run() {
    start(async () => {
      const res = await syncWhatsAppTemplatesNow();
      if ("error" in res) toast.error(res.error);
      else if (res.report) {
        const { total, approved, removed } = res.report;
        toast.success(
          `${total} template${total === 1 ? "" : "s"} synced — ${approved} approved` +
            (removed ? `, ${removed} removed` : ""),
        );
      } else toast.success("Templates synced.");
    });
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-navy-300">
        {count === 0
          ? "No approved templates"
          : `${count} approved template${count === 1 ? "" : "s"}`}
      </span>
      <button
        onClick={run}
        disabled={pending}
        className="label-caps cursor-pointer border border-navy/30 px-3 py-1.5 text-[10px] text-navy transition-colors hover:border-navy disabled:opacity-40"
      >
        {pending ? "Syncing…" : "Sync templates"}
      </button>
    </div>
  );
}
