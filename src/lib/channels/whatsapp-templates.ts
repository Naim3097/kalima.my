import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { GRAPH, whatsappPhoneId, whatsappToken } from "./meta";
import { isOptOutMessage } from "./opt-out";
import { renderTemplateBody, variableCount } from "./template-render";
import { ChannelNotConfigured } from "./types";

/*
  WhatsApp message templates — the only way to reach a customer outside the
  24-hour window, and the only way to start a conversation at all.

  WHAT THIS IS NOT. It is not an authoring tool. Templates are written and
  submitted in Meta's own Business Manager, reviewed by Meta, and approved or
  rejected there. Everything here reads that registry and sends against it.
  Building a submit-for-approval form would have been a day's work producing a
  worse version of a screen the client already has, and it would put Kalima's
  code in the path of an approval outcome it cannot influence.

  So the flow is: write it at Meta -> press Sync in the admin -> it appears in
  the composer once Meta says APPROVED.

  THE WABA ID IS A SEPARATE VARIABLE, AND SEPARATELY OPTIONAL. Listing
  templates is a call against the WhatsApp Business Account, not the phone
  number — a different node with a different id, and `META_WHATSAPP_WABA_ID` is
  the only new credential this feature needs.

  It is deliberately NOT part of whatsappAdapter.configured(). Adding it there
  would have flipped a WhatsApp channel that has been live since 5 August to
  "not connected" the moment this deployed, because the variable did not exist
  yet — taking replies, webhooks and the whole inbox down to ship a feature that
  none of them depend on. Templates report their own readiness instead; see
  templatesBlockedReason.
*/

/*
  Re-exported so a caller reaches for one module about templates rather than
  three. The definitions live in ./template-render and ./opt-out because the
  composer needs them in the browser and this module is server-only.
*/
export { isOptOutMessage, renderTemplateBody };

const WABA_ID = process.env.META_WHATSAPP_WABA_ID ?? "";

/*
  Pinned to the same Graph version as the rest of the Meta integration by
  importing GRAPH rather than rebuilding the URL. Two pins is how one of them
  goes stale — see the note on GRAPH in meta.ts.
*/

function admin() {
  const client = createAdminClient();
  if (!client) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set — templates require it.");
  return client;
}

/*
  Why templates cannot be used right now, or null when they can.

  Names the variable, for the same reason connectBlockedReason does: "not
  configured" sends someone hunting through six possibilities, and Meta hands
  these out from different screens.
*/
export function templatesBlockedReason(): string | null {
  if (!whatsappToken() || !whatsappPhoneId()) {
    return "WhatsApp is not connected, so templates cannot be listed or sent.";
  }
  if (!WABA_ID) {
    return (
      "META_WHATSAPP_WABA_ID is not set on this environment. It is the WhatsApp " +
      "Business Account id (WhatsApp → API Setup, above the phone number — not " +
      "the Phone Number ID). Add it in Vercel and redeploy; it is read at module load."
    );
  }
  return null;
}

/* -------------------------------------------------------------------------
   Meta's template shape, and what we derive from it
   ------------------------------------------------------------------------- */

type MetaComponent = {
  type?: string;
  format?: string;
  text?: string;
  buttons?: { type?: string; text?: string; url?: string; phone_number?: string }[];
  example?: unknown;
};

type MetaTemplate = {
  id?: string;
  name?: string;
  language?: string;
  category?: string;
  status?: string;
  components?: MetaComponent[];
  rejected_reason?: string;
  quality_score?: { score?: string } | string;
};

export type TemplateFields = {
  bodyText: string | null;
  headerFormat: string | null;
  headerText: string | null;
  bodyVariables: number;
  headerVariables: number;
  buttons: MetaComponent["buttons"] | null;
};

/*
  Flattens Meta's components array into the handful of facts the admin needs.

  Component types arrive UPPER CASE ("BODY"), but Meta has not always been
  consistent about that across API versions, so the comparison is
  case-insensitive rather than trusting the current shape.

  A header that is not TEXT (IMAGE, VIDEO, DOCUMENT) carries no text and no
  {{n}} slots, but it DOES require a media parameter at send time. That is
  recorded as the format and refused by the send path rather than sent without
  one — a template whose header we silently omit is rejected by Meta with an
  error about the header, and staff would be looking at the body.
*/
export function deriveTemplateFields(components: MetaComponent[]): TemplateFields {
  let bodyText: string | null = null;
  let headerFormat: string | null = null;
  let headerText: string | null = null;
  let buttons: MetaComponent["buttons"] | null = null;

  for (const c of components ?? []) {
    switch ((c.type ?? "").toUpperCase()) {
      case "BODY":
        bodyText = c.text ?? null;
        break;
      case "HEADER":
        headerFormat = (c.format ?? "TEXT").toUpperCase();
        headerText = c.text ?? null;
        break;
      case "BUTTONS":
        buttons = c.buttons ?? null;
        break;
      default:
        /* FOOTER and anything Meta adds later. Kept in `components` verbatim,
           which is what the send path reads; nothing here needs to flatten it. */
        break;
    }
  }

  return {
    bodyText,
    headerFormat,
    headerText,
    bodyVariables: variableCount(bodyText),
    /* Only a TEXT header can carry {{n}}. A media header takes a URL or an
       uploaded handle instead, which is not a variable in this sense. */
    headerVariables: headerFormat === "TEXT" ? variableCount(headerText) : 0,
    buttons,
  };
}

/* -------------------------------------------------------------------------
   Sync
   ------------------------------------------------------------------------- */

/*
  Reads the whole template registry, following Meta's cursor pagination.

  Bounded at 20 pages. Not because Kalima will ever have 2,000 templates, but
  because a cursor that fails to advance — which is a real Graph failure mode
  under rate limiting, where `paging.next` comes back identical — would
  otherwise loop forever inside a server action holding a request open.
*/
async function fetchAllTemplates(): Promise<MetaTemplate[]> {
  const token = whatsappToken();
  if (!WABA_ID || !token) throw new ChannelNotConfigured("whatsapp");

  const fields = "id,name,language,category,status,components,rejected_reason,quality_score";
  let url = `${GRAPH}/${WABA_ID}/message_templates?limit=100&fields=${fields}`;
  const all: MetaTemplate[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < 20; page++) {
    if (seen.has(url)) break;
    seen.add(url);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: MetaTemplate[];
      paging?: { next?: string };
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(json.error?.message ?? `Could not list WhatsApp templates (${res.status})`);
    }

    all.push(...(json.data ?? []));
    if (!json.paging?.next) break;
    url = json.paging.next;
  }

  return all;
}

export type TemplateSyncReport = { total: number; approved: number; removed: number };

/*
  Pulls Meta's registry into whatsapp_templates.

  DELETES ROWS META NO LONGER RETURNS. This is the half that is easy to skip and
  expensive to skip: a template deleted at Meta but left in our cache keeps
  appearing in the composer, and every send against it fails. The cache is only
  worth having if it can shrink.

  The deletion is scoped to (name, language) pairs absent from a SUCCESSFUL
  fetch. fetchAllTemplates throws rather than returning a short list on failure,
  so a rate-limited call cannot be mistaken for "Meta has no templates" and
  empty the table.
*/
export async function syncWhatsAppTemplates(): Promise<TemplateSyncReport> {
  const templates = await fetchAllTemplates();
  const db = admin();
  const now = new Date().toISOString();

  const rows = templates
    .filter((t) => t.name && t.language)
    .map((t) => {
      const components = t.components ?? [];
      const fields = deriveTemplateFields(components);
      return {
        external_id: t.id ?? null,
        name: t.name as string,
        language: t.language as string,
        category: t.category ?? null,
        status: (t.status ?? "PENDING").toUpperCase(),
        components,
        body_text: fields.bodyText,
        header_format: fields.headerFormat,
        header_text: fields.headerText,
        body_variables: fields.bodyVariables,
        header_variables: fields.headerVariables,
        buttons: fields.buttons,
        /* Meta sends the literal string "NONE" on an approved template; a
           reason that says there is no reason is not a reason. */
        rejected_reason:
          t.rejected_reason && t.rejected_reason.toUpperCase() !== "NONE" ? t.rejected_reason : null,
        quality_score:
          typeof t.quality_score === "string"
            ? t.quality_score
            : (t.quality_score?.score ?? null),
        synced_at: now,
      };
    });

  if (rows.length) {
    const { error } = await db
      .from("whatsapp_templates")
      .upsert(rows, { onConflict: "name,language" });
    if (error) throw new Error(`Template sync failed to write: ${error.message}`);
  }

  /* Anything not touched by this sync is gone from Meta. `synced_at` is the
     marker rather than a separate pass of ids, so the comparison cannot drift
     from what was actually written above. */
  const { data: removed, error: delErr } = await db
    .from("whatsapp_templates")
    .delete()
    .lt("synced_at", now)
    .select("id");
  if (delErr) throw new Error(`Template sync failed to prune: ${delErr.message}`);

  return {
    total: rows.length,
    approved: rows.filter((r) => r.status === "APPROVED").length,
    removed: (removed ?? []).length,
  };
}

/* -------------------------------------------------------------------------
   Reads
   ------------------------------------------------------------------------- */

export type WhatsAppTemplate = {
  name: string;
  language: string;
  category: string | null;
  status: string;
  bodyText: string | null;
  headerFormat: string | null;
  headerText: string | null;
  bodyVariables: number;
  headerVariables: number;
  rejectedReason: string | null;
  qualityScore: string | null;
  syncedAt: string;
};

type TemplateRow = {
  name: string; language: string; category: string | null; status: string;
  body_text: string | null; header_format: string | null; header_text: string | null;
  body_variables: number; header_variables: number;
  rejected_reason: string | null; quality_score: string | null; synced_at: string;
};

function toTemplate(r: TemplateRow): WhatsAppTemplate {
  return {
    name: r.name,
    language: r.language,
    category: r.category,
    status: r.status,
    bodyText: r.body_text,
    headerFormat: r.header_format,
    headerText: r.header_text,
    bodyVariables: r.body_variables,
    headerVariables: r.header_variables,
    rejectedReason: r.rejected_reason,
    qualityScore: r.quality_score,
    syncedAt: r.synced_at,
  };
}

const TEMPLATE_COLUMNS =
  "name, language, category, status, body_text, header_format, header_text, " +
  "body_variables, header_variables, rejected_reason, quality_score, synced_at";

/** Every cached template, approved or not — the admin's template list. */
export async function listWhatsAppTemplates(): Promise<WhatsAppTemplate[]> {
  const { data, error } = await admin()
    .from("whatsapp_templates")
    .select(TEMPLATE_COLUMNS)
    .order("status")
    .order("name");
  if (error) throw new Error(`listWhatsAppTemplates failed: ${error.message}`);
  return ((data ?? []) as unknown as TemplateRow[]).map(toTemplate);
}

/*
  Only what Meta will actually accept right now.

  Media-headed templates are excluded rather than offered and refused: they need
  a media parameter the composer has no way to supply yet, so listing them would
  be an option that can only fail. When media headers are wired this filter is
  the one line that changes.
*/
export async function listSendableTemplates(): Promise<WhatsAppTemplate[]> {
  const { data, error } = await admin()
    .from("whatsapp_templates")
    .select(TEMPLATE_COLUMNS)
    .eq("status", "APPROVED")
    .order("name");
  if (error) throw new Error(`listSendableTemplates failed: ${error.message}`);
  return ((data ?? []) as unknown as TemplateRow[])
    .map(toTemplate)
    .filter((t) => t.headerFormat === null || t.headerFormat === "TEXT");
}

export async function getTemplate(
  name: string,
  language: string,
): Promise<WhatsAppTemplate | null> {
  const { data, error } = await admin()
    .from("whatsapp_templates")
    .select(TEMPLATE_COLUMNS)
    .eq("name", name)
    .eq("language", language)
    .maybeSingle();
  if (error) throw new Error(`getTemplate failed: ${error.message}`);
  return data ? toTemplate(data as unknown as TemplateRow) : null;
}

/* -------------------------------------------------------------------------
   Render and send
   ------------------------------------------------------------------------- */

/*
  Meta rejects a parameter containing a newline, a tab, or four-or-more
  consecutive spaces. The refusal comes back as a generic parameter error that
  says nothing about whitespace, so the natural reading is that the COUNT is
  wrong — and you go looking at the template. Collapsing runs of whitespace here
  means a staff member pasting a multi-line address into a variable gets a
  message that sends rather than an error they cannot decode.
*/
function sanitizeParameter(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export type TemplateSend = {
  /** Recipient in wa_id form — digits, no '+'. See toE164's mirror in meta.ts. */
  to: string;
  name: string;
  language: string;
  /** Positional values for the body's {{1}}, {{2}}, … */
  bodyValues: readonly string[];
  /** Positional values for a TEXT header's {{1}}, … */
  headerValues?: readonly string[];
};

/*
  Sends a template message.

  Deliberately NOT on ChannelAdapter. Templates are a WhatsApp construct: Meta's
  own Messenger surfaces solve the same problem with message TAGS and a
  completely different payload, and Shopee and TikTok with neither. Declaring
  `sendTemplate` on the shared interface would force four adapters to implement
  a concept only one of them has — the exact guessing-at-a-vendor-contract that
  the note at the top of ./types.ts exists to prevent. The one caller narrows to
  WhatsApp explicitly and can be widened when a second platform genuinely earns
  it.
*/
export async function sendWhatsAppTemplate(
  input: TemplateSend,
): Promise<{ externalMessageId: string | null }> {
  const token = whatsappToken();
  const phoneId = whatsappPhoneId();
  if (!token || !phoneId) throw new ChannelNotConfigured("whatsapp");

  const components: Record<string, unknown>[] = [];

  if (input.headerValues?.length) {
    components.push({
      type: "header",
      parameters: input.headerValues.map((text) => ({
        type: "text",
        text: sanitizeParameter(text),
      })),
    });
  }
  if (input.bodyValues.length) {
    components.push({
      type: "body",
      parameters: input.bodyValues.map((text) => ({
        type: "text",
        text: sanitizeParameter(text),
      })),
    });
  }

  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "template",
      template: {
        name: input.name,
        language: { code: input.language },
        /* Omitted entirely when the template takes no parameters. An empty
           array is not the same thing to Meta and is rejected. */
        ...(components.length ? { components } : {}),
      },
    }),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => ({}))) as {
    messages?: { id?: string }[];
    error?: { message?: string };
  };

  if (!res.ok) {
    /* Meta's own wording, verbatim — "Template name does not exist in the
       translation" is the single most common failure here and it names the fix. */
    throw new Error(json.error?.message ?? `WhatsApp template send failed (${res.status})`);
  }

  return { externalMessageId: json.messages?.[0]?.id ?? null };
}

/* -------------------------------------------------------------------------
   Opt-out
   ------------------------------------------------------------------------- */

/*
  Records an opt-out and, when the phone belongs to an account, clears its
  marketing consent so the EMAIL list honours it too.

  Both, not either. Someone who says stop on WhatsApp has told us they do not
  want marketing — reading that as "stop the WhatsApp messages, the emails are
  fine" is a distinction we invented and they did not. The reverse does not
  hold and is not implemented: unsubscribing from an email footer is aimed at
  that list specifically.

  Swallows its own failures. This runs inside the inbound webhook, where the
  message has already been recorded; an opt-out that cannot be written must not
  turn a delivered customer message into a 500 and a Meta retry storm.
*/
export async function recordOptOut(phone: string, body: string | null): Promise<void> {
  try {
    const db = admin();
    await db.rpc("record_whatsapp_opt_out", {
      p_phone: phone,
      p_reason: body?.slice(0, 200) ?? null,
      p_source: "inbound_keyword",
    });
    await db.from("profiles").update({ marketing_consent: false }).eq("phone", phone);
  } catch {
    /* Intentionally silent — see above. */
  }
}

/** Phones that have opted out and not come back. Used by the audience resolver. */
export async function optedOutPhones(): Promise<Set<string>> {
  const { data, error } = await admin()
    .from("whatsapp_opt_outs")
    .select("phone")
    .is("resubscribed_at", null);
  if (error) throw new Error(`optedOutPhones failed: ${error.message}`);
  return new Set((data ?? []).map((r) => (r as { phone: string }).phone));
}
