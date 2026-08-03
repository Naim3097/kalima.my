"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  deleteCampaign,
  previewAudience,
  saveCampaign,
  sendCampaignNow,
  type SegmentInput,
} from "@/app/admin/actions";
import { Card, CardBody, CardHeader, Chip, Table, Td, Tr } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CampaignRow } from "@/lib/admin";

/*
  Email campaign composer.

  Two things are deliberately prominent: who is about to be mailed (the audience
  preview, resolved server-side before anything sends) and that sending is
  irreversible. Everything here respects consent — the audience engine excludes
  anyone without explicit consent or who has unsubscribed, with no override.
*/
export function CampaignManager({
  campaigns,
  subscriberStats,
}: {
  campaigns: CampaignRow[];
  subscriberStats: { active: number; optedOut: number };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [buyersOnly, setBuyersOnly] = useState(false);
  const [minSpentRm, setMinSpentRm] = useState("");
  const [inactiveDays, setInactiveDays] = useState("");
  const [preview, setPreview] = useState<{ count: number; sample: string[] } | null>(null);

  function segment(): SegmentInput {
    const s: SegmentInput = {};
    if (buyersOnly) s.buyersOnly = true;
    const spend = Number(minSpentRm.replace(/,/g, ""));
    if (minSpentRm.trim() && Number.isFinite(spend) && spend > 0) s.minSpentSen = Math.round(spend * 100);
    const days = Number(inactiveDays);
    if (inactiveDays.trim() && Number.isFinite(days) && days > 0) s.inactiveForDays = Math.round(days);
    return s;
  }

  function checkAudience() {
    startTransition(async () => {
      const res = await previewAudience(segment());
      if ("error" in res) {
        toast.error(res.error);
        setPreview(null);
      } else setPreview(res);
    });
  }

  function save() {
    startTransition(async () => {
      const res = await saveCampaign({ name, subject, body, segment: segment() });
      if ("error" in res) toast.error(res.error);
      else {
        toast.success("Campaign saved as a draft.");
        setOpen(false);
        setName(""); setSubject(""); setBody(""); setPreview(null);
        router.refresh();
      }
    });
  }

  function send(c: CampaignRow) {
    startTransition(async () => {
      const res = await sendCampaignNow(c.id);
      if ("error" in res) toast.error(res.error);
      else {
        const r = res.report!;
        toast.success(`Sent ${r.sent} of ${r.total}${r.failed ? ` · ${r.failed} failed` : ""}`);
        router.refresh();
      }
    });
  }

  function remove(c: CampaignRow) {
    startTransition(async () => {
      const res = await deleteCampaign(c.id);
      if ("error" in res) toast.error(res.error);
      else { toast.success("Draft deleted."); router.refresh(); }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="New campaign"
          action={
            !open ? (
              <Button type="button" variant="kalima" size="editorial" onClick={() => setOpen(true)}>
                Compose
              </Button>
            ) : undefined
          }
        />
        <CardBody>
        <p className="text-[13px] tracking-wide text-navy-400">
          {subscriberStats.active} subscriber{subscriberStats.active === 1 ? " has" : "s have"} opted in
          {subscriberStats.optedOut > 0 && ` · ${subscriberStats.optedOut} opted out`}. Only people
          who gave explicit consent and have not unsubscribed are ever mailed.
        </p>

        {open && (
          <div className="mt-5 space-y-5 border-t border-navy-100 pt-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="c-name">Campaign name</Label>
                <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Raya 2026 preview" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="c-subject">Email subject</Label>
                <Input id="c-subject" value={subject} onChange={(e) => setSubject(e.target.value)}
                  placeholder="Defaults to the campaign name" className="mt-1" />
              </div>
            </div>

            <div>
              <Label htmlFor="c-body">Message</Label>
              <Textarea id="c-body" value={body} onChange={(e) => setBody(e.target.value)} rows={8}
                placeholder={"Hi {{name}},\n\nOur Raya collection arrives Friday…"} className="mt-1" />
              <p className="mt-1 text-[11px] tracking-wide text-navy-400">
                Blank lines start new paragraphs. <code>{"{{name}}"}</code> becomes the
                customer&apos;s first name, or “there” when unknown.
              </p>
            </div>

            <div className="rounded border border-navy-100 p-4">
              <p className="label-caps mb-3 text-[10px] text-navy-400">Audience</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="flex items-center gap-2">
                  <Checkbox id="c-buyers" checked={buyersOnly}
                    onCheckedChange={(v) => setBuyersOnly(v === true)} />
                  <Label htmlFor="c-buyers" className="cursor-pointer text-[13px] font-normal">
                    Customers who bought
                  </Label>
                </div>
                <div>
                  <Label htmlFor="c-spend" className="text-[12px]">Spent at least (RM)</Label>
                  <Input id="c-spend" value={minSpentRm} onChange={(e) => setMinSpentRm(e.target.value)}
                    inputMode="decimal" placeholder="any" className="mt-1 h-8 text-[12px]" />
                </div>
                <div>
                  <Label htmlFor="c-inactive" className="text-[12px]">Not bought in (days)</Label>
                  <Input id="c-inactive" value={inactiveDays} onChange={(e) => setInactiveDays(e.target.value)}
                    inputMode="numeric" placeholder="any" className="mt-1 h-8 text-[12px]" />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button type="button" variant="kalimaOutline" size="editorial"
                  disabled={pending} onClick={checkAudience}>
                  {pending ? "Checking…" : "Check audience"}
                </Button>
                {preview && (
                  <p className="text-[13px] tracking-wide text-navy">
                    <strong>{preview.count}</strong> recipient{preview.count === 1 ? "" : "s"}
                    {preview.sample.length > 0 && (
                      <span className="text-navy-400"> — e.g. {preview.sample.join(", ")}</span>
                    )}
                  </p>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <Button type="button" variant="kalima" size="editorial" disabled={pending} onClick={save}>
                Save draft
              </Button>
              <Button type="button" variant="kalimaOutline" size="editorial"
                disabled={pending} onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"}`} />
        {campaigns.length === 0 ? (
          <CardBody>
            <p className="text-[13px] tracking-wide text-navy-400">
              No campaigns yet. Compose one above — it saves as a draft, and nothing sends
              until you press Send.
            </p>
          </CardBody>
        ) : (
          <Table head={["Campaign", "Status", "Result", ""]}>
            {campaigns.map((c) => (
              <Tr key={c.id}>
                <Td>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-[11px] tracking-wide text-navy-400">{c.subject}</p>
                </Td>
                <Td><Chip>{c.status}</Chip></Td>
                <Td className="text-navy-400">
                  {c.status === "sent" || c.status === "failed"
                    ? `${c.sentCount} sent${c.failedCount ? ` · ${c.failedCount} failed` : ""} of ${c.totalCount}`
                    : "—"}
                </Td>
                <Td>
                  {c.status === "draft" && (
                    <div className="flex gap-3">
                      <button type="button" disabled={pending} onClick={() => send(c)}
                        className="label-caps text-[11px] text-navy hover:underline">
                        Send now
                      </button>
                      <button type="button" disabled={pending} onClick={() => remove(c)}
                        className="label-caps text-[11px] text-navy-400 hover:text-navy">
                        Delete
                      </button>
                    </div>
                  )}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
