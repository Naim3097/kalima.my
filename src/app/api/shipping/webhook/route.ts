import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

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
  in_transit: "in_transit",
  "in transit": "in_transit",
  out_for_delivery: "in_transit",
  delivered: "delivered",
  completed: "delivered",
  returned: "returned",
  cancelled: "cancelled",
  canceled: "cancelled",
};

function authorised(req: Request): boolean {
  if (!SECRET) return false; // fail closed
  const url = new URL(req.url);
  const presented =
    req.headers.get("x-webhook-secret") ??
    req.headers.get("x-easyparcel-secret") ??
    url.searchParams.get("secret") ??
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

    const shipmentRef = String(data.shipment_id ?? data.shipmentId ?? data.order_number ?? "");
    const awb = (data.awb_number ?? data.awb ?? data.tracking_number ?? null) as string | null;
    const raw = String(data.current_status ?? data.status ?? "").toLowerCase().trim();
    if (!shipmentRef) return NextResponse.json({ received: true, note: "no shipment id" });

    const { data: shipment } = await db
      .from("shipments")
      .select("id, order_id, status")
      .eq("provider", "easyparcel")
      .eq("provider_ref", shipmentRef)
      .maybeSingle();
    if (!shipment) return NextResponse.json({ received: true, note: "shipment not found" });

    const mapped = STATUS_MAP[raw];
    const patch: Record<string, unknown> = {};
    if (mapped) patch.status = mapped;
    if (awb) patch.tracking_no = awb;
    if (mapped === "delivered") patch.delivered_at = new Date().toISOString();

    if (Object.keys(patch).length) {
      await db.from("shipments").update(patch).eq("id", shipment.id as string);
    }

    // A delivered parcel completes the order — but never downgrade one that has
    // already been refunded or cancelled.
    if (mapped === "delivered") {
      await db.from("orders")
        .update({ status: "completed" })
        .eq("id", shipment.order_id as string)
        .in("status", ["paid", "fulfilled"]);
    }

    return NextResponse.json({ received: true, status: mapped ?? raw });
  } catch {
    // Deliberately 200 — see the response-discipline note above.
    return NextResponse.json({ received: true, note: "could not process" });
  }
}
