"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  deleteCampaign,
  previewAudience,
  previewWhatsAppBroadcast,
  saveCampaign,
  sendCampaignNow,
  type SegmentInput,
} from "@/app/admin/actions";
import { renderTemplateBody } from "@/lib/channels/template-render";
import type { TemplateBinding } from "@/lib/messaging/whatsapp";
import { Card, CardBody, CardHeader, Chip, Table, Td, Tr } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CampaignRow } from "@/lib/admin";

/* The subset of a synced template this composer needs. Only APPROVED ones are
   ever passed in; see listSendableTemplates. */
type Template = {
  name: string;
  language: string;
  category: string | null;
  bodyText: string | null;
  bodyVariables: number;
};

const templateKey = (t: Template) => `${t.name}|${t.language}`;

/*
  Campaign composer — email and WhatsApp.

  Two things stay deliberately prominent on both channels: who is about to be
  contacted (the audience preview, resolved server-side before anything sends)
  and that sending is irreversible. Consent is not one of the options — the
  audience engine excludes anyone without explicit consent or who has opted out,
  with no override on either channel.

  WHAT CHANGES WITH THE CHANNEL is the message half, and only that. On email
  staff write the body; on WhatsApp they choose an approved template and bind
  its {{n}} slots, because the wording belongs to Meta and cannot be edited
  here. The segment controls, the audience check and the send/report loop are
  shared, which is what keeps this one screen rather than two.
*/
export function CampaignManager({
  campaigns,
  subscriberStats,
  templates,
  whatsappAudienceSize,
  whatsappBlocked,
}: {
  campaigns: CampaignRow[];
  subscriberStats: { active: number; optedOut: number };
  templates: Template[];
  whatsappAudienceSize: number | null;
  whatsappBlocked: string | null;
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

  const [channel, setChannel] = useState<"email" | "whatsapp">("email");
  const [templateId, setTemplateId] = useState("");
  /*
    One binding per {{n}}, positionally. Held per template so switching
    templates and back does not silently reuse a binding written for a
    different sentence — the mistake that sends the wrong variable in the right
    slot, which no validation can catch.
  */
  const [bindings, setBindings] = useState<Record<string, TemplateBinding[]>>({});
  const [waPreview, setWaPreview] =
    useState<{ count: number; samples: { phone: string; body: string }[] } | null>(null);

  const selected = templates.find((t) => templateKey(t) === templateId) ?? null;
  const selectedBindings: TemplateBinding[] = selected
    ? (bindings[templateKey(selected)] ??
        /* Default every slot to the customer's first name: it is the binding
           an overwhelming majority of templates want in slot 1, and a wrong
           default that is visible beats an empty control that looks unset. */
        Array.from({ length: selected.bodyVariables }, () => ({ source: "first_name" as const })))
    : [];

  function setBinding(index: number, binding: TemplateBinding) {
    if (!selected) return;
    const key = templateKey(selected);
    setBindings((prev) => {
      const next = [...(prev[key] ?? selectedBindings)];
      next[index] = binding;
      return { ...prev, [key]: next };
    });
  }

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
      if (channel === "whatsapp") {
        if (!selected) {
          toast.error("Choose a template first — the preview renders it.");
          return;
        }
        const res = await previewWhatsAppBroadcast({
          templateName: selected.name,
          templateLanguage: selected.language,
          bindings: selectedBindings,
          segment: segment(),
        });
        if ("error" in res) {
          toast.error(res.error);
          setWaPreview(null);
        } else setWaPreview(res);
        return;
      }

      const res = await previewAudience(segment());
      if ("error" in res) {
        toast.error(res.error);
        setPreview(null);
      } else setPreview(res);
    });
  }

  function save() {
    startTransition(async () => {
      const res = await saveCampaign({
        name,
        subject,
        body,
        segment: segment(),
        channel,
        ...(channel === "whatsapp" && selected
          ? {
              templateName: selected.name,
              templateLanguage: selected.language,
              templateVariables: selectedBindings,
            }
          : {}),
      });
      if ("error" in res) toast.error(res.error);
      else {
        toast.success("Campaign saved as a draft.");
        setOpen(false);
        setName(""); setSubject(""); setBody(""); setPreview(null);
        setTemplateId(""); setBindings({}); setWaPreview(null);
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
          {whatsappAudienceSize !== null && (
            <>
              {" "}
              {whatsappAudienceSize} of them {whatsappAudienceSize === 1 ? "has" : "have"} a phone
              number on file and can be reached on WhatsApp.
            </>
          )}
        </p>

        {open && (
          <div className="mt-5 space-y-5 border-t border-navy-100 pt-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="label-caps text-[10px] text-navy-400">Channel</span>
              {(["email", "whatsapp"] as const).map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => setChannel(ch)}
                  className={`label-caps cursor-pointer border px-3 py-1.5 text-[10px] transition-colors ${
                    channel === ch
                      ? "border-navy bg-navy text-white"
                      : "border-navy/25 text-navy-400 hover:border-navy/50"
                  }`}
                >
                  {ch === "email" ? "Email" : "WhatsApp"}
                </button>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="c-name">Campaign name</Label>
                <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="New arrivals preview" className="mt-1" />
              </div>
              {/* Internal-only on WhatsApp: there is no subject line in a chat,
                  so the field would be a box with no destination. */}
              {channel === "email" && (
                <div>
                  <Label htmlFor="c-subject">Email subject</Label>
                  <Input id="c-subject" value={subject} onChange={(e) => setSubject(e.target.value)}
                    placeholder="Defaults to the campaign name" className="mt-1" />
                </div>
              )}
            </div>

            {channel === "email" ? (
              <div>
                <Label htmlFor="c-body">Message</Label>
                <Textarea id="c-body" value={body} onChange={(e) => setBody(e.target.value)} rows={8}
                  placeholder={"Hi {{name}},\n\nOur new pieces arrive Friday…"} className="mt-1" />
                <p className="mt-1 text-[11px] tracking-wide text-navy-400">
                  Blank lines start new paragraphs. <code>{"{{name}}"}</code> becomes the
                  customer&apos;s first name, or “there” when unknown.
                </p>
              </div>
            ) : (
              /*
                No message box, deliberately. A WhatsApp broadcast reaches people
                outside the 24-hour window, where Meta accepts an approved
                template and nothing else — so the wording is chosen, not
                written, and the only editable parts are the {{n}} slots.
              */
              <div className="space-y-3">
                {whatsappBlocked ? (
                  <p className="border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] leading-relaxed text-amber-900">
                    {whatsappBlocked}
                  </p>
                ) : templates.length === 0 ? (
                  <p className="border border-navy/15 bg-cream-50 px-3 py-2.5 text-[12px] leading-relaxed text-navy-400">
                    No approved templates yet. Templates are written and submitted in Meta
                    Business Manager, then synced from the Channels panel on{" "}
                    <a href="/admin/inbox" className="text-navy underline underline-offset-2">
                      Inbox
                    </a>
                    . A broadcast cannot be composed until Meta approves one.
                  </p>
                ) : (
                  <>
                    <div>
                      <Label htmlFor="c-template">Approved template</Label>
                      <select
                        id="c-template"
                        value={templateId}
                        onChange={(e) => { setTemplateId(e.target.value); setWaPreview(null); }}
                        className="mt-1 w-full cursor-pointer border border-navy/20 bg-white px-2 py-2 text-[13px] text-navy"
                      >
                        <option value="">Choose a template…</option>
                        {templates.map((t) => (
                          <option key={templateKey(t)} value={templateKey(t)}>
                            {t.name} · {t.language}
                            {t.category ? ` · ${t.category.toLowerCase()}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    {selected && (
                      <>
                        {selected.bodyVariables > 0 && (
                          <div className="rounded border border-navy-100 p-4">
                            <p className="label-caps mb-3 text-[10px] text-navy-400">
                              Fill the template
                            </p>
                            <div className="space-y-2">
                              {Array.from({ length: selected.bodyVariables }, (_, i) => {
                                const b = selectedBindings[i] ?? { source: "first_name" as const };
                                return (
                                  <div key={i} className="flex items-center gap-2">
                                    <span className="label-caps w-9 shrink-0 !text-[9px] text-navy-400">
                                      {`{{${i + 1}}}`}
                                    </span>
                                    <select
                                      value={b.source}
                                      onChange={(e) =>
                                        setBinding(
                                          i,
                                          e.target.value === "literal"
                                            ? { source: "literal", value: "" }
                                            : { source: e.target.value as "first_name" | "full_name" },
                                        )
                                      }
                                      className="cursor-pointer border border-navy/20 bg-white px-2 py-1 text-[12px] text-navy"
                                    >
                                      <option value="first_name">First name</option>
                                      <option value="full_name">Full name</option>
                                      <option value="literal">Same for everyone</option>
                                    </select>
                                    {b.source === "literal" && (
                                      <Input
                                        value={b.value}
                                        onChange={(e) =>
                                          setBinding(i, { source: "literal", value: e.target.value })
                                        }
                                        placeholder="e.g. 20%"
                                        className="h-8 flex-1 text-[12px]"
                                      />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Structure only — the names come from the real audience
                            in the Check audience preview below, which is what
                            actually proves the bindings are in the right order. */}
                        <p className="whitespace-pre-wrap border border-navy/15 bg-cream-50 px-3 py-2.5 text-[12px] leading-relaxed text-navy">
                          {renderTemplateBody(
                            selected.bodyText,
                            selectedBindings.map((b) =>
                              b.source === "literal" ? b.value : "…",
                            ),
                          )}
                        </p>
                      </>
                    )}
                  </>
                )}
              </div>
            )}

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
                {channel === "email" && preview && (
                  <p className="text-[13px] tracking-wide text-navy">
                    <strong>{preview.count}</strong> recipient{preview.count === 1 ? "" : "s"}
                    {preview.sample.length > 0 && (
                      <span className="text-navy-400"> — e.g. {preview.sample.join(", ")}</span>
                    )}
                  </p>
                )}
                {channel === "whatsapp" && waPreview && (
                  <p className="text-[13px] tracking-wide text-navy">
                    <strong>{waPreview.count}</strong> recipient
                    {waPreview.count === 1 ? "" : "s"} with a number on file
                  </p>
                )}
              </div>

              {/*
                The rendered sample, against REAL names from the resolved
                audience rather than invented ones. A preview built from
                placeholder data only proves the template renders; this proves
                the bindings are in the right order, which is the mistake that
                actually reaches customers.
              */}
              {channel === "whatsapp" && waPreview && waPreview.samples.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {waPreview.samples.map((sample) => (
                    <div key={sample.phone} className="border border-navy/10 bg-cream-50 px-3 py-2">
                      <p className="label-caps !text-[9px] text-navy-300">{sample.phone}</p>
                      <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-relaxed text-navy">
                        {sample.body}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="kalima"
                size="editorial"
                /* A WhatsApp draft with no template cannot be saved — the check
                   constraint on `campaigns` refuses it, and a disabled button is
                   a kinder way to say so than a database error. */
                disabled={pending || (channel === "whatsapp" && !selected)}
                onClick={save}
              >
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
          <Table head={["Campaign", "Channel", "Status", "Result", ""]}>
            {campaigns.map((c) => (
              <Tr key={c.id}>
                <Td>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-[11px] tracking-wide text-navy-400">
                    {/* The template, not the subject, is what a WhatsApp
                        campaign actually sends — showing `subject` here would
                        display an internal label as though it reached anyone. */}
                    {c.channel === "whatsapp"
                      ? (c.templateName ?? "no template")
                      : c.subject}
                  </p>
                </Td>
                <Td>
                  <Chip>{c.channel === "whatsapp" ? "WhatsApp" : "Email"}</Chip>
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
