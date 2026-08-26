import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import {
  getTemplate,
  renderTemplateBody,
  sendWhatsAppTemplate,
  templatesBlockedReason,
} from "@/lib/channels/whatsapp-templates";

/*
  Transactional WhatsApp: one approved template, sent automatically when an
  order is paid, shipped, or delivered.

  The send path is the same one the inbox composer and broadcasts use
  (sendWhatsAppTemplate); what this adds is the trigger, the values, and the
  bookkeeping around exactly-once. It is deliberately FIRE-AND-FORGET from the
  caller's side: a payment settlement or a courier booking must never fail
  because Meta was slow, so every entry point here swallows its own errors and
  records them in whatsapp_automation_sends instead.

  WHY VALUES ARE FIXED PER EVENT. Meta's template parameters are positional
  and unnamed. Rather than build a binding editor, each event publishes an
  ordered list of values it can supply; the template staff choose for that
  event simply consumes the first N of them. The list is shown in the admin
  beside the picker, so the person writing the template at Meta knows that
  {{1}} is the first name and {{2}} the order reference. A template that wants
  more values than the event offers cannot be selected.
*/

export type AutomationEvent = "order_paid" | "order_shipped" | "order_delivered";

export const AUTOMATION_EVENTS: {
  event: AutomationEvent;
  label: string;
  when: string;
  /** The values supplied, in {{1}}, {{2}}, … order. */
  values: string[];
}[] = [
  {
    event: "order_paid",
    label: "Payment confirmed",
    when: "the moment a payment settles",
    values: ["First name", "Order reference", "Total paid (e.g. RM166.49)", "Items (e.g. Anna Top × 1, Luna Palazo × 2)"],
  },
  {
    event: "order_shipped",
    label: "Parcel on its way",
    when: "when a parcel is booked or marked shipped",
    values: ["First name", "Order reference", "Courier", "Tracking number", "Tracking link"],
  },
  {
    event: "order_delivered",
    label: "Delivered",
    when: "when the courier reports delivery",
    values: ["First name", "Order reference"],
  },
];

export type AutomationSetting = {
  event: AutomationEvent;
  templateName: string | null;
  templateLanguage: string | null;
  enabled: boolean;
};

function admin() {
  const client = createAdminClient();
  if (!client) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return client;
}

export async function getAutomations(): Promise<AutomationSetting[]> {
  const { data, error } = await admin()
    .from("whatsapp_automations")
    .select("event, template_name, template_language, enabled");
  if (error) throw new Error(`getAutomations failed: ${error.message}`);
  const byEvent = new Map((data ?? []).map((r) => [r.event as AutomationEvent, r]));
  return AUTOMATION_EVENTS.map(({ event }) => {
    const r = byEvent.get(event);
    return {
      event,
      templateName: (r?.template_name as string | null) ?? null,
      templateLanguage: (r?.template_language as string | null) ?? null,
      enabled: Boolean(r?.enabled),
    };
  });
}

/*
  A Malaysian number as Meta wants it: digits only, country code, no '+'.

  Orders store the phone as the shopper typed it — "0123456789" for Malaysia,
  "+65 9123 4567" overseas — and profiles store E.164 with the '+'. All three
  have to become "60123456789" / "6591234567". A leading 0 is the domestic
  trunk prefix and is replaced by 60; anything already carrying a country code
  is kept.
*/
export function toWaId(phone: string | null | undefined, country = "MY"): string | null {
  const raw = (phone ?? "").trim();
  if (!raw) return null;
  const international = raw.startsWith("+") || raw.startsWith("00");
  let digits = raw.replace(/\D+/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (!international && digits.startsWith("0")) {
    digits = (country.toUpperCase() === "MY" ? "60" : "") + digits.slice(1);
  }
  return digits.length >= 8 ? digits : null;
}

function firstName(recipient: string | null | undefined, email: string): string {
  const name = (recipient ?? "").trim().split(/\s+/)[0];
  return name || email.split("@")[0] || "there";
}

function rm(sen: number): string {
  return `RM${(sen / 100).toFixed(2)}`;
}

type OrderForMessage = {
  id: string;
  reference: string;
  email: string;
  phone: string | null;
  total_sen: number;
  shipping_address: { recipient?: string; phone?: string; country?: string } | null;
  order_items: { product_name: string; qty: number }[];
};

async function loadOrder(orderId: string): Promise<OrderForMessage | null> {
  const { data } = await admin()
    .from("orders")
    .select("id, reference, email, phone, total_sen, shipping_address, order_items(product_name, qty)")
    .eq("id", orderId)
    .maybeSingle();
  return (data as OrderForMessage | null) ?? null;
}

/* What each event can say. Mirrors AUTOMATION_EVENTS[].values exactly. */
async function valuesFor(event: AutomationEvent, order: OrderForMessage): Promise<string[]> {
  const name = firstName(order.shipping_address?.recipient, order.email);
  switch (event) {
    case "order_paid": {
      const items = order.order_items.map((i) => `${i.product_name} × ${i.qty}`).join(", ");
      return [name, order.reference, rm(order.total_sen), items || "your order"];
    }
    case "order_shipped": {
      const { data: s } = await admin()
        .from("shipments")
        .select("courier, tracking_no, tracking_url")
        .eq("order_id", order.id)
        .in("status", ["booked", "in_transit", "delivered"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { courierName, trackingLink } = await import("@/lib/couriers");
      const courier = courierName(s?.courier as string | null) ?? (s?.courier as string | null) ?? "our courier";
      const tracking = (s?.tracking_no as string | null) ?? "";
      const link = trackingLink(s?.courier as string | null, tracking || null, s?.tracking_url as string | null) ?? "";
      return [name, order.reference, courier, tracking || "to follow", link || "kalima.my/account"];
    }
    case "order_delivered":
      return [name, order.reference];
  }
}

async function optedOut(waId: string): Promise<boolean> {
  const { data } = await admin()
    .from("whatsapp_opt_outs")
    .select("phone")
    .in("phone", [waId, `+${waId}`])
    .is("resubscribed_at", null)
    .limit(1);
  return Boolean(data?.length);
}

/*
  Fires one automation for one order. Safe to call from anywhere, any number
  of times: the claim row makes the second call a no-op, and nothing here
  throws. Returns what happened so a caller that cares (tests, the admin) can
  read it; callers on the money path ignore it.
*/
export async function sendAutomation(
  event: AutomationEvent,
  orderId: string,
): Promise<{ outcome: "sent" | "skipped" | "failed" | "duplicate"; detail?: string }> {
  const db = admin();

  /* Claim first. A duplicate key here means another caller got there. */
  const { error: claimErr } = await db
    .from("whatsapp_automation_sends")
    .insert({ event, order_id: orderId, status: "pending" });
  if (claimErr) return { outcome: "duplicate" };

  const finish = async (
    status: "sent" | "failed" | "skipped",
    patch: Record<string, unknown> = {},
  ) => {
    await db
      .from("whatsapp_automation_sends")
      .update({ status, ...patch })
      .eq("event", event)
      .eq("order_id", orderId);
    return { outcome: status, detail: patch.detail as string | undefined };
  };

  try {
    const { data: cfg } = await db
      .from("whatsapp_automations")
      .select("template_name, template_language, enabled")
      .eq("event", event)
      .maybeSingle();
    if (!cfg?.enabled || !cfg.template_name || !cfg.template_language) {
      return finish("skipped", { detail: "automation not enabled" });
    }

    const blocked = templatesBlockedReason();
    if (blocked) return finish("skipped", { detail: blocked });

    const order = await loadOrder(orderId);
    if (!order) return finish("failed", { detail: "order not found" });

    const country = order.shipping_address?.country ?? "MY";
    const waId = toWaId(order.shipping_address?.phone || order.phone, country);
    if (!waId) return finish("skipped", { detail: "no usable phone on the order" });
    if (await optedOut(waId)) return finish("skipped", { detail: "customer has opted out", phone: waId });

    const template = await getTemplate(cfg.template_name as string, cfg.template_language as string);
    if (!template) return finish("failed", { detail: "template not in synced list", phone: waId });
    if (template.status !== "APPROVED") {
      return finish("failed", { detail: `template is ${template.status}`, phone: waId });
    }
    if (template.headerVariables > 0 || (template.headerFormat && template.headerFormat !== "TEXT")) {
      return finish("failed", { detail: "template header needs values this automation cannot supply", phone: waId });
    }

    const all = await valuesFor(event, order);
    if (template.bodyVariables > all.length) {
      return finish("failed", {
        detail: `template takes ${template.bodyVariables} values, event offers ${all.length}`,
        phone: waId,
      });
    }
    const values = all.slice(0, template.bodyVariables);

    /*
      Recorded in the inbox as an outbound message on the customer's thread,
      so staff answering a reply can see what was sent. The thread is keyed by
      wa_id exactly as inbound traffic keys it, so a reply lands in the same
      conversation.
    */
    const { data: conv } = await db
      .from("conversations")
      .upsert(
        {
          channel: "whatsapp",
          external_thread_id: waId,
          external_user_id: waId,
          external_handle: order.shipping_address?.recipient ?? null,
        },
        { onConflict: "channel,external_thread_id", ignoreDuplicates: false },
      )
      .select("id")
      .maybeSingle();

    let messageId: string | null = null;
    if (conv?.id) {
      const preview = renderTemplateBody(template.bodyText, values) || `[template: ${template.name}]`;
      const { data: rec } = await db.rpc("record_outbound_message", {
        p_conversation_id: conv.id,
        p_direction: "outbound",
        p_body: preview,
        p_sent_by: null,
        p_delivery: "pending",
        p_template_name: template.name,
      });
      messageId = (rec as { message_id?: string } | null)?.message_id ?? null;
    }

    try {
      const { externalMessageId } = await sendWhatsAppTemplate({
        to: waId,
        name: template.name,
        language: template.language,
        bodyValues: values,
      });
      if (messageId) {
        await db.from("messages")
          .update({ delivery: "sent", external_message_id: externalMessageId })
          .eq("id", messageId);
      }
      return finish("sent", { phone: waId, template_name: template.name, message_id: messageId });
    } catch (e) {
      const detail = e instanceof Error ? e.message : "send failed";
      if (messageId) {
        await db.from("messages")
          .update({ delivery: "failed", delivery_error: detail.slice(0, 500) })
          .eq("id", messageId);
      }
      return finish("failed", { detail: detail.slice(0, 500), phone: waId, template_name: template.name, message_id: messageId });
    }
  } catch (e) {
    return finish("failed", { detail: (e instanceof Error ? e.message : "unexpected error").slice(0, 500) });
  }
}

/*
  Never-throws wrapper for the money and shipping paths. AWAIT IT: on
  serverless a promise left dangling is killed with the response, and the
  message silently never goes. It cannot fail the caller — every path inside
  resolves — so awaiting costs the caller only the send's own time.
*/
export async function notifyOrderEvent(event: AutomationEvent, orderId: string): Promise<void> {
  try {
    await sendAutomation(event, orderId);
  } catch (e) {
    console.error(`[whatsapp] automation ${event} for ${orderId} threw:`, e);
  }
}
