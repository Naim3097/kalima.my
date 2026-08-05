import "server-only";

import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveAudience, type Segment } from "./audience";

/*
  Campaign send pipeline (email via Resend).

  Sends are sequential with a small pause rather than fired in parallel: Resend
  rate-limits, and a broadcast that trips the limit half way through is far
  worse than one that takes a few seconds longer. Every message writes a
  campaign_recipients row, so the report is the log rather than a guess.

  Each message carries a per-subscriber unsubscribe link. That is a PDPA
  requirement, and doing it per subscriber (not per email address) means the
  link cannot be forged from someone else's address.
*/

const FROM = process.env.RESEND_FROM || "Kalima <hello@kalima.my>";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.kalima.my";
/** Resend's default is 2 requests/second; stay comfortably under it. */
const PAUSE_MS = 120;

function client(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}

function admin() {
  const c = createAdminClient();
  if (!c) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return c;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/*
  Marketing shell. Deliberately a separate template from the transactional one
  in lib/email: this one must carry an unsubscribe link, and a transactional
  receipt must not (unsubscribing from a receipt makes no sense and an
  unsubscribe on a transactional footer invites accidental opt-outs).
*/
function shell(body: string, unsubscribeUrl: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f7f3ec;font-family:Georgia,serif;color:#383c61">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3ec;padding:32px 0">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fbf9f5;border:1px solid #e3d7c6">
          <tr><td style="padding:28px 32px;text-align:center;border-bottom:1px solid #e3d7c6">
            <div style="font-size:22px;letter-spacing:6px;color:#383c61">KALIMA</div>
            <div style="font-size:9px;letter-spacing:4px;color:#686c8f;text-transform:uppercase;margin-top:4px">Timeless Modest Luxury</div>
          </td></tr>
          <tr><td style="padding:32px;font-size:15px;line-height:1.7">${body}</td></tr>
          <tr><td style="padding:20px 32px;border-top:1px solid #e3d7c6;font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#9b9cb0;text-align:center">
            Kalima · Designed in Malaysia · kalima.my<br/>
            <a href="${unsubscribeUrl}" style="color:#9b9cb0">Unsubscribe</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

/** `{{name}}` is the only variable; unknown tokens are left alone rather than
    blanked, so a typo is visible in the preview instead of silently vanishing. */
function render(template: string, vars: { name: string }): string {
  return template.replace(/\{\{\s*name\s*\}\}/g, escapeHtml(vars.name));
}

/** Body text -> simple HTML paragraphs, escaped. Staff write plain text. */
function bodyHtml(text: string, vars: { name: string }): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${render(escapeHtml(p), vars).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

async function unsubscribeUrlFor(email: string): Promise<string> {
  const db = admin();
  // Ensure a token exists for this address even if they only ever had an account.
  const { data } = await db
    .from("newsletter_subscribers")
    .select("unsubscribe_token")
    .eq("email", email)
    .maybeSingle();

  let token = data?.unsubscribe_token as string | undefined;
  if (!token) {
    const { data: created } = await db
      .from("newsletter_subscribers")
      .insert({ email, source: "campaign" })
      .select("unsubscribe_token")
      .single();
    token = created?.unsubscribe_token as string | undefined;
  }
  return `${APP_URL}/unsubscribe?token=${token ?? ""}`;
}

export type SendReport = { total: number; sent: number; failed: number };

/*
  Sends a campaign. Claims it with a conditional update first (draft -> sending)
  so a double click cannot mail the whole list twice.
*/
export async function sendCampaign(campaignId: string): Promise<SendReport | { error: string }> {
  const db = admin();

  const { data: claimed } = await db
    .from("campaigns")
    .update({ status: "sending" })
    .eq("id", campaignId)
    .eq("status", "draft")
    .select("id, name, subject, body, segment")
    .maybeSingle();
  if (!claimed) return { error: "This campaign is already sending or has been sent." };

  const resend = client();
  if (!resend) {
    await db.from("campaigns").update({ status: "draft" }).eq("id", campaignId);
    return { error: "RESEND_API_KEY is not set — email sending is not configured." };
  }

  let recipients;
  try {
    recipients = await resolveAudience((claimed.segment ?? {}) as Segment);
  } catch (e) {
    await db.from("campaigns").update({ status: "draft" }).eq("id", campaignId);
    return { error: e instanceof Error ? e.message : "Could not resolve the audience." };
  }

  await db.from("campaigns")
    .update({ total_count: recipients.length })
    .eq("id", campaignId);

  let sent = 0;
  let failed = 0;

  for (const r of recipients) {
    const vars = { name: r.name?.split(" ")[0] ?? "there" };
    let error: string | null = null;
    try {
      const unsub = await unsubscribeUrlFor(r.email);
      const res = await resend.emails.send({
        from: FROM,
        to: r.email,
        subject: render(claimed.subject ?? claimed.name, vars),
        html: shell(bodyHtml(claimed.body as string, vars), unsub),
        headers: {
          // One-click unsubscribe, which materially helps inbox placement.
          "List-Unsubscribe": `<${unsub}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      if (res.error) error = res.error.message;
    } catch (e) {
      error = e instanceof Error ? e.message : "send failed";
    }

    if (error) failed++; else sent++;

    await db.from("campaign_recipients").upsert(
      {
        campaign_id: campaignId,
        email: r.email,
        status: error ? "failed" : "sent",
        error,
        sent_at: error ? null : new Date().toISOString(),
      },
      { onConflict: "campaign_id,email" },
    );

    await new Promise((res) => setTimeout(res, PAUSE_MS));
  }

  await db.from("campaigns").update({
    status: failed && !sent ? "failed" : "sent",
    sent_at: new Date().toISOString(),
    total_count: recipients.length,
    sent_count: sent,
    failed_count: failed,
  }).eq("id", campaignId);

  return { total: recipients.length, sent, failed };
}
