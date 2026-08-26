import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { adapterFor } from "./registry";
import { replyWindow, type ReplyWindow } from "./reply-window";
import {
  getTemplate,
  renderTemplateBody,
  sendWhatsAppTemplate,
  templatesBlockedReason,
} from "./whatsapp-templates";
import {
  CHANNEL_LABEL,
  REPLY_WINDOW_HOURS,
  channelDoes,
  type Channel,
} from "./types";

/*
  Unified inbox: read models and the send path.

  The send path is the interesting half. Everything about a reply that is
  POLICY — may we send at all, does this thread still accept free text — is
  decided here, server-side, before an adapter is touched.
*/

function admin() {
  const client = createAdminClient();
  if (!client) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set — the inbox requires it.");
  return client;
}

export type ThreadSummary = {
  id: string;
  channel: Channel;
  channelLabel: string;
  handle: string;
  preview: string;
  lastMessageAt: string | null;
  unread: number;
  status: "open" | "snoozed" | "closed";
  assignedTo: string | null;
  customerId: string | null;
  /** Computed server-side; the composer reads this, never a client timer. */
  window: ReplyWindow;
};

function windowFor(channel: Channel, lastInboundAt: string | null): ReplyWindow {
  return replyWindow(REPLY_WINDOW_HOURS[channel], lastInboundAt);
}

export async function listThreads(limit = 100): Promise<ThreadSummary[]> {
  const { data, error } = await admin()
    .from("conversations")
    .select(
      "id, channel, external_handle, external_user_id, customer_id, last_inbound_at, last_message_at, unread_count, status, assigned_to, messages(body, sent_at, direction)",
    )
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`listThreads failed: ${error.message}`);

  return ((data ?? []) as unknown as {
    id: string; channel: Channel; external_handle: string | null;
    external_user_id: string | null; customer_id: string | null;
    last_inbound_at: string | null; last_message_at: string | null;
    unread_count: number; status: ThreadSummary["status"]; assigned_to: string | null;
    messages: { body: string | null; sent_at: string; direction: string }[];
  }[]).map((c) => {
    // The preview is the newest message that a customer would recognise —
    // internal notes are ours and must never surface as "the last thing said".
    const visible = (c.messages ?? [])
      .filter((m) => m.direction !== "note")
      .sort((a, b) => Date.parse(b.sent_at) - Date.parse(a.sent_at));
    return {
      id: c.id,
      channel: c.channel,
      channelLabel: CHANNEL_LABEL[c.channel],
      handle: c.external_handle ?? c.external_user_id ?? "Unknown",
      preview: visible[0]?.body?.slice(0, 140) ?? "",
      lastMessageAt: c.last_message_at,
      unread: c.unread_count,
      status: c.status,
      assignedTo: c.assigned_to,
      customerId: c.customer_id,
      window: windowFor(c.channel, c.last_inbound_at),
    };
  });
}

export type ThreadMessage = {
  id: string;
  direction: "inbound" | "outbound" | "note";
  body: string | null;
  sentAt: string;
  delivery: string;
  deliveryError: string | null;
};

export type CustomerContext = {
  name: string | null;
  email: string | null;
  phone: string | null;
  orders: { reference: string; status: string; totalSen: number; createdAt: string }[];
  loyaltyPoints: number | null;
  tier: string | null;
};

export type ThreadDetail = {
  summary: ThreadSummary;
  messages: ThreadMessage[];
  customer: CustomerContext | null;
};

export async function getThread(conversationId: string): Promise<ThreadDetail | null> {
  const { data: c, error } = await admin()
    .from("conversations")
    .select(
      "id, channel, external_handle, external_user_id, customer_id, last_inbound_at, last_message_at, unread_count, status, assigned_to",
    )
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new Error(`getThread failed: ${error.message}`);
  if (!c) return null;

  const { data: msgs } = await admin()
    .from("messages")
    .select("id, direction, body, sent_at, delivery, delivery_error")
    .eq("conversation_id", conversationId)
    .order("sent_at");

  const messages: ThreadMessage[] = ((msgs ?? []) as {
    id: string; direction: ThreadMessage["direction"]; body: string | null;
    sent_at: string; delivery: string; delivery_error: string | null;
  }[]).map((m) => ({
    id: m.id,
    direction: m.direction,
    body: m.body,
    sentAt: m.sent_at,
    delivery: m.delivery,
    deliveryError: m.delivery_error,
  }));

  /*
    The customer panel is the reason this inbox is worth more than four browser
    tabs: the person answering sees who they are talking to, what they bought
    and what they are owed, without leaving the thread.
  */
  let customer: CustomerContext | null = null;
  if (c.customer_id) {
    const [profileRes, ordersRes, balanceRes] = await Promise.all([
      admin().from("profiles").select("full_name, phone").eq("id", c.customer_id).maybeSingle(),
      admin()
        .from("orders")
        .select("reference, status, total_sen, created_at")
        .eq("user_id", c.customer_id)
        .order("created_at", { ascending: false })
        .limit(5),
      admin().rpc("loyalty_balance", { p_user_id: c.customer_id }),
    ]);

    let tier: string | null = null;
    try {
      const { data: t } = await admin().rpc("customer_tier", { p_user_id: c.customer_id });
      tier = (t as { name?: string } | null)?.name ?? null;
    } catch {
      // Tier is decoration on this screen; its absence must not blank the panel.
    }

    customer = {
      name: profileRes.data?.full_name ?? null,
      email: null,
      phone: profileRes.data?.phone ?? null,
      orders: ((ordersRes.data ?? []) as {
        reference: string; status: string; total_sen: number; created_at: string;
      }[]).map((o) => ({
        reference: o.reference,
        status: o.status,
        totalSen: o.total_sen,
        createdAt: o.created_at,
      })),
      loyaltyPoints: typeof balanceRes.data === "number" ? balanceRes.data : null,
      tier,
    };
  }

  return {
    summary: {
      id: c.id,
      channel: c.channel as Channel,
      channelLabel: CHANNEL_LABEL[c.channel as Channel],
      handle: c.external_handle ?? c.external_user_id ?? "Unknown",
      preview: "",
      lastMessageAt: c.last_message_at,
      unread: c.unread_count,
      status: c.status,
      assignedTo: c.assigned_to,
      customerId: c.customer_id,
      window: windowFor(c.channel as Channel, c.last_inbound_at),
    },
    messages,
    customer,
  };
}

export type SendResult = { ok: true; messageId: string } | { error: string };

/*
  Sends a free-text reply.

  ORDER OF OPERATIONS, and why:

  1. Re-derive the reply window HERE, from the stored last_inbound_at. The
     caller may have been looking at a page rendered an hour ago; a window that
     was open when the page loaded can be closed by the time send is pressed.
     Trusting the client's view would produce exactly the failure this whole
     mechanism exists to prevent.
  2. Record the message as 'pending' BEFORE calling the platform. If the process
     dies mid-send, the thread shows a pending reply rather than nothing —
     visible and diagnosable beats silently absent.
  3. Send, then mark 'sent' or 'failed' with the upstream error attached.

  A failed send is deliberately NOT deleted. Staff need to see that the reply did
  not land, and re-typing it is a smaller cost than believing it was delivered.
*/
export async function sendReply(input: {
  conversationId: string;
  body: string;
  staffId: string;
}): Promise<SendResult> {
  const body = input.body.trim();
  if (!body) return { error: "Type a message first." };

  const { data: c, error } = await admin()
    .from("conversations")
    .select("id, channel, external_thread_id, external_user_id, last_inbound_at")
    .eq("id", input.conversationId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!c) return { error: "That conversation no longer exists." };

  const channel = c.channel as Channel;
  if (!channelDoes(channel, "messaging")) {
    return { error: `${CHANNEL_LABEL[channel]} does not carry messages.` };
  }

  // (1) Policy, decided server-side from stored state.
  const win = windowFor(channel, c.last_inbound_at);
  if (!win.open) return { error: win.reason ?? "This conversation cannot be replied to." };

  const adapter = adapterFor(channel);
  if (!adapter.configured()) {
    return {
      error: `${CHANNEL_LABEL[channel]} is not connected yet, so the reply cannot be delivered.`,
    };
  }

  // (2) Record before sending.
  const { data: recorded, error: recordErr } = await admin().rpc("record_outbound_message", {
    p_conversation_id: input.conversationId,
    p_direction: "outbound",
    p_body: body,
    p_sent_by: input.staffId,
    p_delivery: "pending",
  });
  if (recordErr) return { error: recordErr.message };
  const messageId = (recorded as { message_id: string }).message_id;

  // (3) Send, then reconcile the delivery state.
  try {
    const { externalMessageId } = await adapter.sendMessage({
      externalThreadId: c.external_thread_id as string,
      externalUserId: (c.external_user_id as string | null) ?? null,
      body,
    });
    await admin()
      .from("messages")
      .update({ delivery: "sent", external_message_id: externalMessageId })
      .eq("id", messageId);
    return { ok: true, messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "send failed";
    await admin()
      .from("messages")
      .update({ delivery: "failed", delivery_error: message.slice(0, 500) })
      .eq("id", messageId);
    return { error: `Could not deliver: ${message}` };
  }
}

/*
  Sends an approved template.

  THE OTHER HALF OF sendReply, and the mirror image of its policy. sendReply
  refuses when the window is CLOSED; this one works either side of it, because
  a template is what Meta accepts when free text is no longer allowed — and
  also, at a price, when it still is.

  It is not restricted to a closed window on purpose. Staff reopening a
  conversation the customer started three days ago and staff sending an order
  update inside the window are the same action with the same compliance
  properties, and a rule that permitted one and not the other would only push
  someone to wait for the window to close.

  WHATSAPP ONLY, checked here rather than assumed. Templates are a WhatsApp
  construct; Instagram and Facebook solve the same problem with message tags and
  a different payload entirely. See the note on sendWhatsAppTemplate.

  THE TEMPLATE IS RE-READ FROM THE CACHE, never trusted from the caller. The
  client sends a name; approval status, language and variable count all come
  from the row. A composer rendered ten minutes ago may be offering a template
  Meta paused since, and the failure mode of trusting it is a send that is
  billed, rejected, and recorded in the thread as though it went out.
*/
export async function sendTemplateMessage(input: {
  conversationId: string;
  templateName: string;
  templateLanguage: string;
  /** Positional values for the body's {{1}}, {{2}}, … */
  variables: string[];
  /** Positional values for a TEXT header's {{1}}, … */
  headerVariables?: string[];
  staffId: string;
}): Promise<SendResult> {
  const { data: c, error } = await admin()
    .from("conversations")
    .select("id, channel, external_thread_id, external_user_id")
    .eq("id", input.conversationId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!c) return { error: "That conversation no longer exists." };

  const channel = c.channel as Channel;
  if (channel !== "whatsapp") {
    return {
      error: `Templates are a WhatsApp feature — ${CHANNEL_LABEL[channel]} does not accept them.`,
    };
  }

  const blocked = templatesBlockedReason();
  if (blocked) return { error: blocked };

  const template = await getTemplate(input.templateName, input.templateLanguage);
  if (!template) {
    return { error: "That template is no longer in the synced list. Press Sync templates and try again." };
  }
  if (template.status !== "APPROVED") {
    return {
      error:
        `Meta has this template as ${template.status}, not APPROVED, so it cannot be sent.` +
        (template.rejectedReason ? ` Reason given: ${template.rejectedReason}.` : ""),
    };
  }

  /*
    Exact match on both counts, not "at least".

    Meta rejects too FEW and too MANY parameters with the same unhelpful error,
    and the rejection arrives after the message is already recorded as pending.
    Checking here turns that into a sentence a staff member can act on, naming
    the number the template actually wants.
  */
  const body = input.variables.map((v) => v.trim());
  const header = (input.headerVariables ?? []).map((v) => v.trim());
  if (body.length !== template.bodyVariables) {
    return {
      error: `This template takes ${template.bodyVariables} value${
        template.bodyVariables === 1 ? "" : "s"
      }, and ${body.length} ${body.length === 1 ? "was" : "were"} supplied.`,
    };
  }
  if (header.length !== template.headerVariables) {
    return {
      error: `This template's header takes ${template.headerVariables} value${
        template.headerVariables === 1 ? "" : "s"
      }, and ${header.length} ${header.length === 1 ? "was" : "were"} supplied.`,
    };
  }
  if (body.some((v) => !v) || header.some((v) => !v)) {
    return { error: "Every value in the template needs filling in." };
  }

  /*
    What the thread will show. Meta renders the real message from the template it
    holds; this is our copy of what the customer sees, so the conversation reads
    as a conversation rather than as a template name and a shrug.
  */
  const preview = renderTemplateBody(template.bodyText, body) || `[template: ${template.name}]`;

  const { data: recorded, error: recordErr } = await admin().rpc("record_outbound_message", {
    p_conversation_id: input.conversationId,
    p_direction: "outbound",
    p_body: preview,
    p_sent_by: input.staffId,
    p_delivery: "pending",
    p_template_name: template.name,
  });
  if (recordErr) return { error: recordErr.message };
  const messageId = (recorded as { message_id: string }).message_id;

  try {
    const { externalMessageId } = await sendWhatsAppTemplate({
      /* external_thread_id is the customer's wa_id — digits, no '+'. That is
         exactly what Meta wants as `to`, so it is passed through unchanged. */
      to: c.external_thread_id as string,
      name: template.name,
      language: template.language,
      bodyValues: body,
      headerValues: header,
    });
    await admin()
      .from("messages")
      .update({ delivery: "sent", external_message_id: externalMessageId })
      .eq("id", messageId);
    return { ok: true, messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "send failed";
    await admin()
      .from("messages")
      .update({ delivery: "failed", delivery_error: message.slice(0, 500) })
      .eq("id", messageId);
    return { error: `Could not deliver: ${message}` };
  }
}

/** Internal note. Never sent — enforced by the direction, not by this caller. */
export async function addNote(input: {
  conversationId: string;
  body: string;
  staffId: string;
}): Promise<SendResult> {
  const body = input.body.trim();
  if (!body) return { error: "Type a note first." };

  const { data, error } = await admin().rpc("record_outbound_message", {
    p_conversation_id: input.conversationId,
    p_direction: "note",
    p_body: body,
    p_sent_by: input.staffId,
  });
  if (error) return { error: error.message };
  return { ok: true, messageId: (data as { message_id: string }).message_id };
}

export async function markRead(conversationId: string): Promise<void> {
  await admin().rpc("mark_conversation_read", { p_conversation_id: conversationId });
}

export async function getCannedReplies(): Promise<{ id: string; title: string; body: string }[]> {
  const { data, error } = await admin()
    .from("canned_replies")
    .select("id, title, body")
    .order("sort_order");
  if (error) throw new Error(`getCannedReplies failed: ${error.message}`);
  return (data ?? []) as { id: string; title: string; body: string }[];
}
