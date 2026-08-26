import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { adapterFor } from "@/lib/channels/registry";
import { isChannel, channelDoes, type InboundMessage } from "@/lib/channels/types";
import { isOptOutMessage, recordOptOut } from "@/lib/channels/whatsapp-templates";

/*
  Inbound message webhooks — the ingestion half of the unified inbox.

  Separate route from the order webhook because the two carry different payloads
  and different failure modes, even where a platform signs them identically. A
  malformed order and a malformed message should not share a handler.

  AUTHENTICATION FAILS CLOSED, delegated to the adapter for the same reason as
  the order webhook: Shopee, TikTok and Meta each sign differently. An unwired
  adapter returns false from verifyWebhook and null from verifySubscription, so
  before any credentials exist this endpoint can be neither subscribed to nor
  posted to.

  That matters because this handler writes customer conversations on the
  service-role client. An open version would let anyone inject messages that
  appear to staff as genuine customer enquiries — a convincing phishing surface
  aimed at the people who can issue refunds.

  RAW BODY FIRST, always, then verify, then parse. Platforms sign the exact bytes
  they sent.
*/
export const dynamic = "force-dynamic";

/*
  Subscription handshake. Meta verifies a webhook URL by GETting it with
  hub.mode / hub.verify_token / hub.challenge and expecting the challenge echoed
  in plain text; the marketplaces have equivalents. The adapter decides — and an
  unwired one refuses, so no live subscription can be pointed at this app before
  it can actually handle the traffic.
*/
export async function GET(
  request: Request,
  { params }: { params: Promise<{ channel: string }> },
) {
  const { channel } = await params;
  if (!isChannel(channel) || !channelDoes(channel, "messaging")) {
    return NextResponse.json({ error: "Unknown channel" }, { status: 404 });
  }

  const challenge = adapterFor(channel).verifySubscription(new URL(request.url).searchParams);
  if (challenge === null) {
    return NextResponse.json({ error: "Subscription refused" }, { status: 403 });
  }
  // Echoed as plain text: Meta compares the body byte-for-byte and a JSON
  // wrapper fails the handshake.
  return new NextResponse(challenge, {
    headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ channel: string }> },
) {
  const { channel } = await params;
  if (!isChannel(channel) || !channelDoes(channel, "messaging")) {
    return NextResponse.json({ error: "Unknown channel" }, { status: 404 });
  }

  const rawBody = await request.text();

  const adapter = adapterFor(channel);
  if (!adapter.verifyWebhook(rawBody, request.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();
  if (!db) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  try {
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ received: true, note: "body was not json" });
    }

    const messages: InboundMessage[] = adapter.parseMessageWebhook(payload);
    // Delivery receipts, read receipts and typing indicators are valid traffic
    // that carries no message. Not an error.
    if (messages.length === 0) {
      return NextResponse.json({ received: true, messages: 0 });
    }

    let recorded = 0;
    let duplicates = 0;

    for (const m of messages) {
      const { data, error } = await db.rpc("record_inbound_message", {
        p_channel: channel,
        p_external_thread_id: m.externalThreadId,
        p_external_message_id: m.externalMessageId,
        p_external_user_id: m.externalUserId,
        p_external_handle: m.externalHandle,
        p_body: m.body,
        // Attachment URLs are stored as sent for now. Mirroring the bytes into
        // Storage lands with the first wired adapter, since only then do we
        // know what auth their CDN needs — an expired URL is a lost record.
        p_attachments: m.attachments.length ? m.attachments : null,
        p_sent_at: m.sentAt,
        p_contact_phone: m.contactPhone,
        p_contact_email: m.contactEmail,
      });

      if (error) {
        // Logged against the sync log so a parsing bug is visible in the admin
        // rather than only in a server log.
        await db.from("channel_sync_log").insert({
          channel,
          level: "error",
          event: "message_import_failed",
          summary: `Could not record a ${channel} message: ${error.message}`,
          meta: { external_thread_id: m.externalThreadId },
        });
        continue;
      }

      const r = (data ?? {}) as {
        recorded?: boolean;
        conversation_id?: string;
        handle_missing?: boolean;
      };
      if (r.recorded) recorded += 1;
      else duplicates += 1;

      /*
        "STOP" is how a WhatsApp opt-out arrives.

        There is no unsubscribe link to click — a broadcast template lands in a
        chat window, and the only reply channel is the chat itself. So the
        opt-out has to be read out of ordinary inbound traffic, here, at the one
        point every inbound message passes through.

        Deliberately NOT suppressed for a duplicate delivery: a redelivered
        "STOP" recording an opt-out that is already recorded is harmless (the
        RPC is idempotent), whereas skipping it would mean a customer's only
        instruction to stop is lost because Meta happened to retry the message
        that carried it.

        WhatsApp only. Instagram and Facebook have no broadcast path in this
        product, so there is nothing there for a stop keyword to switch off, and
        acting on one would silently drop a customer off the email list for
        typing "stop" mid-conversation.
      */
      if (channel === "whatsapp" && m.contactPhone && isOptOutMessage(m.body)) {
        await recordOptOut(m.contactPhone, m.body);
      }

      /*
        Fill in the sender's name, for platforms that omit it from the payload.

        Instagram and Facebook send only a scoped id, so without this every
        thread reads as 17 digits. The lookup is a network call and cannot live
        in parseMessageWebhook, which is synchronous by contract — so it happens
        here, and only when the thread actually has no name. An established
        conversation reports handle_missing false and costs nothing.

        Deliberately after the message is recorded, and deliberately unable to
        fail the request: the customer's message is already safely stored, and a
        rate limit or a deleted account is not a reason to hand the platform a
        non-200 and invite a redelivery. resolveHandle returns null rather than
        throwing; this is the belt to that braces.
      */
      if (r.recorded && r.handle_missing && r.conversation_id && m.externalUserId) {
        try {
          const handle = await adapter.resolveHandle(m.externalUserId);
          if (handle) {
            await db.rpc("set_conversation_handle", {
              p_conversation_id: r.conversation_id,
              p_handle: handle,
            });
          }
        } catch {
          /* Thread keeps its id; a later message tries again. */
        }
      }
    }

    return NextResponse.json({ received: true, recorded, duplicates });
  } catch {
    // 200 on anything we merely could not process, so the platform stops
    // retrying a payload that will never succeed. 401 is reserved for a failed
    // signature, which a legitimate sender never sees.
    return NextResponse.json({ received: true, note: "could not process" });
  }
}
