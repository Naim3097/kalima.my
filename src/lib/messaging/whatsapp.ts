import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import {
  getTemplate,
  renderTemplateBody,
  sendWhatsAppTemplate,
  templatesBlockedReason,
} from "@/lib/channels/whatsapp-templates";
import { resolveWhatsAppAudience, type Segment } from "./audience";

/*
  WhatsApp broadcast pipeline — the other arm of lib/messaging/send.ts.

  Same shape as the email one on purpose: claim the campaign with a conditional
  update so a double click cannot send twice, resolve the audience, send
  sequentially with a pause, write a campaign_recipients row per message, and
  reconcile the campaign counters at the end. Anything a reader already knows
  from send.ts holds here.

  WHAT IS GENUINELY DIFFERENT:

  - THE BODY IS META'S, NOT OURS. Outside the 24-hour window only an approved
    template is accepted, and a broadcast is by definition outside it. So the
    campaign carries a template reference and positional bindings; the text the
    customer reads lives at Meta. `campaigns.body` is ignored on this channel.
  - THE RATE LIMIT IS REAL AND EXPENSIVE. WhatsApp's Cloud API meters both
    throughput and per-conversation cost, and a number that trips the limit mid
    broadcast has its quality rating marked down — which is a slow, hard thing
    to undo. The pause is correspondingly larger than Resend's.
  - THERE IS NO UNSUBSCRIBE LINK. The opt-out arrives as an inbound "STOP",
    recorded by the messages webhook. The audience resolver excludes it; nothing
    here appends anything to the message, because a template's text cannot be
    appended to.
*/

const admin = () => {
  const c = createAdminClient();
  if (!c) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return c;
};

/*
  Roughly 4 messages/second. Meta's documented default for a number in good
  standing is considerably higher, but the ceiling that matters is the one that
  gets a number throttled, and a broadcast that takes two minutes instead of
  thirty seconds costs nothing anyone will notice.
*/
const PAUSE_MS = 250;

/*
  How a template's {{n}} slots are filled, per recipient.

  'literal' is the same value for everyone — a discount code, a collection name.
  The rest read from the recipient. Kept to what the audience resolver actually
  returns: a binding that names a field we do not have would fail per-recipient,
  halfway through a send, which is the worst place to discover it.
*/
export type TemplateBinding =
  | { source: "first_name" }
  | { source: "full_name" }
  | { source: "literal"; value: string };

export function isTemplateBinding(v: unknown): v is TemplateBinding {
  if (!v || typeof v !== "object") return false;
  const s = (v as { source?: unknown }).source;
  if (s === "first_name" || s === "full_name") return true;
  return s === "literal" && typeof (v as { value?: unknown }).value === "string";
}

/*
  Resolves one binding for one recipient.

  "there" is the fallback for a missing name, matching the email pipeline's
  choice — "Hi there" reads as written, where "Hi " reads as broken. A template
  parameter may not be empty, so there has to be SOME fallback; making it the
  same one in both channels means a customer on both lists is greeted the same
  way.
*/
export function bindValue(binding: TemplateBinding, name: string | null): string {
  switch (binding.source) {
    case "literal":
      return binding.value;
    case "first_name":
      return name?.trim().split(/\s+/)[0] || "there";
    case "full_name":
      return name?.trim() || "there";
  }
}

export type WhatsAppSendReport = { total: number; sent: number; failed: number };

export async function sendWhatsAppCampaign(
  campaignId: string,
): Promise<WhatsAppSendReport | { error: string }> {
  const db = admin();

  /*
    Checked BEFORE the claim. Claiming and then discovering the environment is
    not configured leaves the campaign stuck in 'sending', which needs a manual
    database edit to undo — the email pipeline hits this and has to put the
    status back by hand. Cheaper to look first.
  */
  const blocked = templatesBlockedReason();
  if (blocked) return { error: blocked };

  const { data: claimed } = await db
    .from("campaigns")
    .update({ status: "sending" })
    .eq("id", campaignId)
    .eq("status", "draft")
    .eq("channel", "whatsapp")
    .select("id, name, segment, template_name, template_language, template_variables")
    .maybeSingle();
  if (!claimed) {
    return { error: "This campaign is already sending, has been sent, or is not a WhatsApp campaign." };
  }

  /* Every early return past this point must release the claim, or the campaign
     is stranded in 'sending' with nothing having gone out. */
  const release = async (error: string) => {
    await db.from("campaigns").update({ status: "draft" }).eq("id", campaignId);
    return { error };
  };

  const templateName = claimed.template_name as string | null;
  const templateLanguage = claimed.template_language as string | null;
  if (!templateName || !templateLanguage) {
    return release("This campaign has no template selected.");
  }

  const template = await getTemplate(templateName, templateLanguage);
  if (!template) {
    return release("That template is not in the synced list. Press Sync templates and try again.");
  }
  if (template.status !== "APPROVED") {
    return release(
      `Meta has this template as ${template.status}, not APPROVED, so it cannot be sent.`,
    );
  }

  const bindings = (claimed.template_variables ?? []) as unknown[];
  if (!bindings.every(isTemplateBinding)) {
    return release("The template's variable settings could not be read. Re-save the campaign.");
  }
  if (bindings.length !== template.bodyVariables) {
    return release(
      `This template takes ${template.bodyVariables} value${
        template.bodyVariables === 1 ? "" : "s"
      }, and the campaign supplies ${bindings.length}. Re-save it against the current template.`,
    );
  }
  /*
    A media header cannot be filled from here, and a TEXT header with variables
    has no per-recipient binding in the campaign schema. Both are refused rather
    than sent short — Meta rejects a missing header parameter, and it would do
    so once per recipient across the whole list.
  */
  if (template.headerFormat && template.headerFormat !== "TEXT") {
    return release(
      `This template has a ${template.headerFormat} header, which broadcasts cannot supply yet. Use a text-only template.`,
    );
  }
  if (template.headerVariables > 0) {
    return release(
      "This template's header contains a variable, which broadcasts cannot fill yet. Use a template whose header is fixed text.",
    );
  }

  let recipients;
  try {
    recipients = await resolveWhatsAppAudience((claimed.segment ?? {}) as Segment);
  } catch (e) {
    return release(e instanceof Error ? e.message : "Could not resolve the audience.");
  }

  await db.from("campaigns").update({ total_count: recipients.length }).eq("id", campaignId);

  let sent = 0;
  let failed = 0;

  for (const r of recipients) {
    const values = bindings.map((b) => bindValue(b, r.name));
    let error: string | null = null;

    try {
      await sendWhatsAppTemplate({
        /*
          Meta wants the recipient WITHOUT a leading '+'. profiles.phone stores
          it WITH one — the same one-character mismatch that silently broke
          customer linking on the inbound side (see toE164 in lib/channels/meta).
          Stripping it here is the outbound half of that lesson.
        */
        to: r.phone.replace(/[^\d]/g, ""),
        name: template.name,
        language: template.language,
        bodyValues: values,
      });
    } catch (e) {
      error = e instanceof Error ? e.message : "send failed";
    }

    if (error) failed++;
    else sent++;

    await db.from("campaign_recipients").upsert(
      {
        campaign_id: campaignId,
        phone: r.phone,
        status: error ? "failed" : "sent",
        error,
        sent_at: error ? null : new Date().toISOString(),
      },
      { onConflict: "campaign_id,phone" },
    );

    await new Promise((res) => setTimeout(res, PAUSE_MS));
  }

  await db
    .from("campaigns")
    .update({
      status: failed && !sent ? "failed" : "sent",
      sent_at: new Date().toISOString(),
      total_count: recipients.length,
      sent_count: sent,
      failed_count: failed,
    })
    .eq("id", campaignId);

  return { total: recipients.length, sent, failed };
}

/*
  What the first few recipients will actually read, for the composer.

  Rendered from the SAME bindings the send path uses, against real names from
  the resolved audience — not a made-up "John Smith". A preview built from
  placeholder data proves the template renders; a preview built from the
  audience proves the bindings are in the right order, which is the mistake that
  actually happens.
*/
export async function previewWhatsAppCampaign(input: {
  templateName: string;
  templateLanguage: string;
  bindings: TemplateBinding[];
  segment: Segment;
}): Promise<{ count: number; samples: { phone: string; body: string }[] } | { error: string }> {
  const template = await getTemplate(input.templateName, input.templateLanguage);
  if (!template) return { error: "That template is not in the synced list." };

  const recipients = await resolveWhatsAppAudience(input.segment);

  return {
    count: recipients.length,
    samples: recipients.slice(0, 3).map((r) => ({
      /* Masked: the composer is a screen someone may well be sharing, and the
         point of the sample is the wording, not the number. */
      phone: r.phone.slice(0, -4).replace(/\d(?=\d{3})/g, "•") + r.phone.slice(-4),
      body: renderTemplateBody(
        template.bodyText,
        input.bindings.map((b) => bindValue(b, r.name)),
      ),
    })),
  };
}
