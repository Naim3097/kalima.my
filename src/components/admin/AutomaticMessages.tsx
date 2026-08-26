"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveWhatsAppAutomation } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WhatsAppTemplate } from "@/lib/channels/whatsapp-templates";
import type { AutomationSetting } from "@/lib/messaging/whatsapp-automations";

/*
  Which approved template goes out for each order event.

  The values each event can fill are listed beside the picker in {{n}} order,
  because that list is the contract the template at Meta has to be written
  against — there is no binding editor, by design (see whatsapp-automations.ts).
  A template that takes more values than the event offers is shown but cannot
  be chosen, with the reason, rather than hidden.
*/
export default function AutomaticMessages({
  events,
  settings,
  templates,
}: {
  events: { event: string; label: string; when: string; values: string[] }[];
  settings: AutomationSetting[];
  templates: WhatsAppTemplate[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Record<string, { key: string; enabled: boolean }>>(() =>
    Object.fromEntries(
      settings.map((s) => [
        s.event,
        { key: s.templateName ? `${s.templateName}|${s.templateLanguage}` : "", enabled: s.enabled },
      ]),
    ),
  );

  function save(event: string) {
    const d = draft[event];
    const [name = "", language = ""] = d.key.split("|");
    start(async () => {
      const res = await saveWhatsAppAutomation({
        event, templateName: name, templateLanguage: language, enabled: d.enabled,
      });
      if ("error" in res) toast.error(res.error);
      else {
        toast.success("Automatic message saved.");
        router.refresh();
      }
    });
  }

  return (
    <ul className="divide-y divide-navy/5">
      {events.map((e) => {
        const d = draft[e.event] ?? { key: "", enabled: false };
        const usable = templates.filter((t) => t.status === "APPROVED");
        return (
          <li key={e.event} className="grid gap-3 py-4 md:grid-cols-[1fr_1.2fr]">
            <div>
              <p className="text-[13px] text-navy">{e.label}</p>
              <p className="text-[11px] text-navy-300">Sent {e.when}.</p>
              <p className="mt-2 text-[11px] text-navy-400">Values the template can use, in order:</p>
              <ol className="mt-1 space-y-0.5 text-[11px] text-navy-400">
                {e.values.map((v, i) => (
                  <li key={i}>
                    <span className="font-mono text-navy">{`{{${i + 1}}}`}</span> {v}
                  </li>
                ))}
              </ol>
            </div>
            <div className="space-y-2">
              <Select
                value={d.key}
                onValueChange={(key) => setDraft((x) => ({ ...x, [e.event]: { ...d, key } }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={usable.length ? "Choose an approved template" : "No approved templates yet"} />
                </SelectTrigger>
                <SelectContent>
                  {usable.map((t) => {
                    const tooMany = t.bodyVariables > e.values.length;
                    const badHeader = t.headerVariables > 0 || (t.headerFormat && t.headerFormat !== "TEXT");
                    return (
                      <SelectItem
                        key={`${t.name}|${t.language}`}
                        value={`${t.name}|${t.language}`}
                        disabled={tooMany || Boolean(badHeader)}
                      >
                        {t.name} · {t.language} · {t.bodyVariables} value{t.bodyVariables === 1 ? "" : "s"}
                        {tooMany ? " — needs more values than this event has" : badHeader ? " — header not supported" : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <div className="flex items-center justify-between gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-[12px] text-navy">
                  <Checkbox
                    checked={d.enabled}
                    onCheckedChange={(v) => setDraft((x) => ({ ...x, [e.event]: { ...d, enabled: v === true } }))}
                  />
                  Send automatically
                </label>
                <Button type="button" variant="kalimaOutline" size="editorial" disabled={pending} onClick={() => save(e.event)}>
                  Save
                </Button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
