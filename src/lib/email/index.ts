import "server-only";

import { Resend } from "resend";
import { formatRM } from "@/lib/format";
import { getOrderByReference, type OrderAddress } from "@/lib/commerce";

/*
  Transactional email via Resend. Null-until-configured: with no RESEND_API_KEY
  every send is a no-op, so the app runs (and the checkout completes) without
  email set up. Add RESEND_API_KEY + RESEND_FROM to switch it on.

  Brand voice matches the storefront: warm, restrained, navy on cream.
*/

function client(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}

const FROM = process.env.RESEND_FROM || "Kalima <orders@kalima.my>";

/*
  Where a customer's reply goes, when that differs from the From address.

  The From address must be on a domain we can prove we own — DKIM signing and
  SPF are checked against it, and no provider will let us send as @gmail.com
  because we cannot publish records in Google's DNS. Replies have no such
  requirement, so support can live in an ordinary mailbox while the mail itself
  is sent from the verified domain and passes authentication.
*/
const REPLY_TO = process.env.RESEND_REPLY_TO?.trim() || undefined;

async function send(to: string, subject: string, html: string): Promise<void> {
  const resend = client();
  if (!resend) {
    // Not configured. Say so once per send — a silent no-op looks identical to
    // a delivered email, and that is how an order confirmation goes missing
    // for weeks without anyone noticing.
    console.warn(`[email] RESEND_API_KEY unset — "${subject}" to ${to} was NOT sent`);
    return;
  }
  try {
    const { error } = await resend.emails.send({
      from: FROM,
      to,
      subject,
      html,
      ...(REPLY_TO ? { replyTo: REPLY_TO } : {}),
    });
    // Resend reports rejection in the body, not by throwing: an unverified
    // sending domain arrives here, not in the catch.
    if (error) console.error(`[email] rejected "${subject}" to ${to}:`, error.message);
  } catch (e) {
    // Never let a mail failure break an order — but never lose it either.
    console.error(`[email] failed "${subject}" to ${to}:`, (e as Error).message);
  }
}

/* ---- templates ---------------------------------------------------------- */

function shell(heading: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f7f3ec;font-family:Georgia,serif;color:#383c61">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3ec;padding:32px 0">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fbf9f5;border:1px solid #e3d7c6">
          <tr><td style="padding:28px 32px;text-align:center;border-bottom:1px solid #e3d7c6">
            <div style="font-size:22px;letter-spacing:6px;color:#383c61">KALIMA</div>
            <div style="font-size:9px;letter-spacing:4px;color:#686c8f;text-transform:uppercase;margin-top:4px">Timeless Modest Luxury</div>
          </td></tr>
          <tr><td style="padding:32px">
            <h1 style="font-size:22px;font-weight:normal;margin:0 0 16px">${heading}</h1>
            ${body}
          </td></tr>
          <tr><td style="padding:20px 32px;border-top:1px solid #e3d7c6;font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#9b9cb0;text-align:center">
            Kalima · Designed in Malaysia · kalima.my
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

/*
  Customer-supplied text goes into an HTML mail, so it is escaped — the same
  rule the campaign sender in lib/messaging/send.ts already applies, and for a
  stronger reason: the delivery address and the recipient's name arrive from an
  unauthenticated checkout, and the new-order copy of this mail lands in the
  SHOP's inbox from the shop's own verified domain.
*/
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function itemsTable(items: { product_name: string; color_name: string; size: string; qty: number; line_total_sen: number }[]): string {
  const rows = items
    .map(
      (i) => `<tr>
        <td style="padding:8px 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#383c61">
          ${escapeHtml(i.product_name)} <span style="color:#9b9cb0">· ${escapeHtml(i.color_name)} · ${escapeHtml(i.size)} × ${i.qty}</span>
        </td>
        <td align="right" style="padding:8px 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#383c61">${formatRM(i.line_total_sen / 100)}</td>
      </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e3d7c6;margin:16px 0">${rows}</table>`;
}

/*
  Every line between the items and the amount charged.

  Showing only a total is how a customer ends up reading RM59 of items against
  RM69 paid, with the shipping never named — which reads as an overcharge and
  arrives as a support message. Rows that are zero are omitted rather than shown
  as RM0.00, except shipping: "FREE" is worth saying out loud.
*/
function totalsTable(
  order: {
    subtotal_sen: number;
    discount_sen: number;
    shipping_sen: number;
    total_sen: number;
  },
  label: string,
): string {
  const cell = "font-family:Helvetica,Arial,sans-serif;font-size:13px;padding:3px 0";
  const row = (name: string, value: string, colour = "#686c8f") =>
    `<tr><td style="${cell};color:${colour}">${name}</td>
         <td align="right" style="${cell};color:${colour}">${value}</td></tr>`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
            style="border-top:1px solid #e3d7c6;padding-top:8px">
    ${row("Subtotal", formatRM(order.subtotal_sen / 100))}
    ${order.discount_sen > 0 ? row("Discount", `−${formatRM(order.discount_sen / 100)}`, "#2f7a52") : ""}
    ${row("Shipping", order.shipping_sen === 0 ? "FREE" : formatRM(order.shipping_sen / 100))}
    <tr><td style="${cell};color:#383c61;border-top:1px solid #e3d7c6;padding-top:8px">
          <strong>${label}</strong></td>
        <td align="right" style="${cell};color:#383c61;border-top:1px solid #e3d7c6;padding-top:8px">
          <strong>${formatRM(order.total_sen / 100)}</strong></td></tr>
  </table>`;
}

/*
  The delivery address, so a customer can catch a wrong one while it is still
  cheap to fix — before the parcel is packed rather than after it is lost.
*/
function addressBlock(address: OrderAddress | null): string {
  if (!address) return "";
  const lines = [
    address.recipient,
    address.line1,
    address.line2,
    `${address.postcode} ${address.city}`.trim(),
    address.state,
    address.country,
    address.phone,
  ]
    .filter(Boolean)
    .map((l) => escapeHtml(String(l)));

  return `<p style="font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.7;color:#383c61;margin:22px 0 0">
      <span style="font-size:10px;letter-spacing:2px;color:#9b9cb0;text-transform:uppercase">Delivering to</span><br>
      ${lines.join("<br>")}
    </p>`;
}

/* ---- public API --------------------------------------------------------- */

/** "We've received your order" — sent when a pending order is placed. */
export async function sendOrderReceivedEmail(reference: string, email: string): Promise<void> {
  const order = await getOrderByReference(reference, email);
  if (!order) return;

  const body = `
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#686c8f">
      Thank you — we've received your order <strong style="color:#383c61">${order.reference}</strong>.
      We'll email again the moment your payment is confirmed.
    </p>
    ${itemsTable(order.items)}
    ${totalsTable(order, "Total")}
    ${addressBlock(order.shipping_address)}`;
  await send(email, `Order received — ${reference}`, shell("Order received", body));
}

/** "Payment confirmed" — sent from the webhook once the order is paid. */
export async function sendPaymentConfirmedEmail(reference: string, email: string): Promise<void> {
  const order = await getOrderByReference(reference, email);
  if (!order) return;

  const body = `
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#686c8f">
      Your payment is confirmed and <strong style="color:#383c61">${order.reference}</strong> is being prepared.
      We'll be in touch with tracking once it ships.
    </p>
    ${itemsTable(order.items)}
    ${totalsTable(order, "Total paid")}
    ${addressBlock(order.shipping_address)}
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#9b9cb0;margin-top:22px">
      Wrong address? Reply to this email straight away and we'll change it before the parcel goes out.
    </p>`;
  await send(email, `Payment confirmed — ${reference}`, shell("Payment confirmed", body));
}

/*
  "You have a paid order" — to the shop, not the customer.

  Without this nobody learns a sale happened until someone opens the admin.
  Sent alongside the customer's confirmation, on the same paid transition, so
  it inherits that path's exactly-once guarantee.

  Addressed to store_settings.store_email so it follows the shop rather than a
  hardcoded address, and carries what is needed to pack the parcel — the items,
  the address, and a way to reach the buyer.
*/
export async function sendNewOrderNotification(reference: string, email: string): Promise<void> {
  const order = await getOrderByReference(reference, email);
  if (!order) return;

  const { createAdminClient } = await import("@/lib/supabase/server");
  const db = createAdminClient();
  if (!db) return;

  const { data: settings } = await db
    .from("store_settings")
    .select("store_email")
    .eq("id", 1)
    .maybeSingle();

  const to = (settings?.store_email as string | undefined)?.trim();
  if (!to) {
    console.warn(`[email] no store_email set — nobody was told about ${reference}`);
    return;
  }

  const body = `
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#686c8f">
      <strong style="color:#383c61">${order.reference}</strong> has been paid —
      ${formatRM(order.total_sen / 100)}.
    </p>
    ${itemsTable(order.items)}
    ${totalsTable(order, "Total paid")}
    ${addressBlock(order.shipping_address)}
    <p style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#686c8f;margin-top:14px">
      ${escapeHtml(order.email)}
    </p>`;

  await send(to, `New paid order — ${reference}`, shell("New paid order", body));
}
