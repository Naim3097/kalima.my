import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { awardLoyaltyPoints } from "@/lib/commerce";

/*
  EasyParcel shipment status pushes.

  AUTHENTICATION. EasyParcel publishes no HMAC signing scheme, so this uses a
  shared secret presented as a header. It FAILS CLOSED: with no secret in the
  environment every request is rejected. That matters because this handler runs
  on the service-role client and rewrites tracking numbers and order status —
  an unauthenticated version would let anyone mark orders delivered.

  Comparison is constant-time, with a length check first because
  timingSafeEqual throws on mismatched lengths.

  RESPONSE DISCIPLINE. Returns 200 even when the shipment is unknown or
  processing fails, so EasyParcel stops retrying. A silent failure here is
  invisible to the sender — watch the logs, not the status code.
*/
export const dynamic = "force-dynamic";

const SECRET = process.env.EASYPARCEL_WEBHOOK_SECRET ?? "";

/** EasyParcel status -> our shipment_status enum. Unknown values are ignored
    rather than guessed, so a new upstream status can't corrupt our state. */
const STATUS_MAP: Record<string, string> = {
  pending: "pending",
  booked: "booked",
  processing: "booked",
  "to be collected": "booked",
  "schedule in arrangement": "booked",
  collected: "in_transit",
  "drop off": "in_transit",
  in_transit: "in_transit",
  "in transit": "in_transit",
  "delivery in transit": "in_transit",
  out_for_delivery: "in_transit",
  delivered: "delivered",
  completed: "delivered",
  returned: "returned",
  cancelled: "cancelled",
  canceled: "cancelled",
  cancel: "cancelled",
};

/*
  The numeric shipment_status_code from the same push, mapped from the table
  the spec publishes. The words beside a code vary by courier ("Parcel been
  collected at ABC"), so when a code is present it outranks the prose.
  8 (On Hold) is deliberately absent: our enum has no equivalent, and guessing
  one would move a parcel that has not moved.
*/
const STATUS_CODE_MAP: Record<number, string> = {
  0: "cancelled",
  2: "booked",
  3: "in_transit",
  4: "in_transit",
  5: "delivered",
  6: "returned",
  7: "booked",
  11: "in_transit",
};

function authorised(req: Request): boolean {
  if (!SECRET) return false; // fail closed
  /*
    HEADERS ONLY. A ?secret= fallback used to be accepted here, which put the
    shared secret into Vercel's access logs, any intermediary proxy log, and the
    Referer of anything the page later loaded — the comment above already
    described this route as header-authenticated, and the query fallback quietly
    contradicted it.

    If EasyParcel's dashboard ever turns out to be unable to send a header, the
    answer is a long random path segment on the endpoint, not a secret in the
    query string: the path is at least not forwarded onward in a Referer.
  */
  const presented =
    req.headers.get("x-webhook-secret") ??
    req.headers.get("x-easyparcel-secret") ??
    "";
  const a = Buffer.from(presented);
  const b = Buffer.from(SECRET);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!SECRET) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }
  if (!authorised(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();
  if (!db) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const data = ((body.data as Record<string, unknown>) ?? body) ?? {};

    /*
      The 2026-06 payloads key everything on shipment_number (ES-XXXX-XXXXX),
      flat in the body — the wrapped shipment_id shapes are kept for whatever
      an older subscription still delivers.
    */
    const shipmentRef = String(
      data.shipment_number ?? data.shipment_id ?? data.shipmentId ?? data.order_number ?? "",
    );
    const awb = (data.awb_number ?? data.awb ?? data.tracking_number ?? null) as string | null;
    /* shipment.awb.update carries these; a status push carries neither. */
    const labelUrl = (data.awb_url ?? null) as string | null;
    const trackingUrl = (data.tracking_url ?? null) as string | null;
    const raw = String(data.shipment_status ?? data.current_status ?? data.status ?? "")
      .toLowerCase()
      .trim();
    const code = Number(data.shipment_status_code ?? data.latest_shipment_status_code ?? NaN);
    if (!shipmentRef) return NextResponse.json({ received: true, note: "no shipment id" });

    const { data: shipment } = await db
      .from("shipments")
      .select("id, order_id, status")
      .eq("provider", "easyparcel")
      .eq("provider_ref", shipmentRef)
      .maybeSingle();
    if (!shipment) return NextResponse.json({ received: true, note: "shipment not found" });

    const mapped = STATUS_CODE_MAP[code] ?? STATUS_MAP[raw];
    const patch: Record<string, unknown> = {};
    if (mapped) patch.status = mapped;
    if (awb) patch.tracking_no = awb;
    if (labelUrl) patch.label_url = labelUrl;
    if (trackingUrl) patch.tracking_url = trackingUrl;
    if (mapped === "delivered") patch.delivered_at = new Date().toISOString();

    if (Object.keys(patch).length) {
      await db.from("shipments").update(patch).eq("id", shipment.id as string);
    }

    // A delivered parcel completes the order — but never downgrade one that has
    // already been refunded or cancelled.
    if (mapped === "delivered") {
      const { data: completed } = await db.from("orders")
        .update({ status: "completed" })
        .eq("id", shipment.order_id as string)
        .in("status", ["paid", "fulfilled"])
        .select("id")
        .maybeSingle();

      // Points earn on completion, and only for an order this push actually
      // completed — so a repeated delivery notice cannot re-award.
      if (completed) await awardLoyaltyPoints(completed.id as string);
    }

    return NextResponse.json({ received: true, status: mapped ?? raw });
  } catch {
    // Deliberately 200 — see the response-discipline note above.
    return NextResponse.json({ received: true, note: "could not process" });
  }
}
