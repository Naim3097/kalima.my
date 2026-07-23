import { NextResponse } from "next/server";
import { debugRawServiceList } from "@/lib/payments/leanx";

// TEMP diagnostic route — returns the raw LeanX list-payment-services payload
// so we can inspect the exact service-object shape. Delete after fixing parser.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const raw = await debugRawServiceList();
    return NextResponse.json(raw);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
