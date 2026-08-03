import { NextResponse } from "next/server";
import {
  ORDERS,
  CUSTOMERS,
  CAMPAIGNS,
  AFFILIATES,
  TIERS,
  SHIPMENTS,
  SALES_14D,
  CHANNEL_SPLIT,
} from "@/data/demo";

/*
  Back-office read API. One handler per resource keyed by path segment —
  each of these becomes a Supabase query (behind an admin role check) in the
  phase that owns it; see PROJECT_PLAN.md §6.

  Demo preview: unauthenticated, read-only, seed data. Do not add mutating
  verbs here until the auth/RLS work in Phase 2/3 lands.
*/
const RESOURCES = {
  orders: () => ORDERS,
  customers: () => CUSTOMERS,
  campaigns: () => CAMPAIGNS,
  affiliates: () => AFFILIATES,
  loyalty: () => TIERS,
  shipments: () => SHIPMENTS,
  // 'sync' and 'inbox' are gone: Phases 8 and 9 landed, so both screens read
  // the real tables and their fixtures were deleted.
  sales: () => SALES_14D,
  channels: () => CHANNEL_SPLIT,
} as const;

type Resource = keyof typeof RESOURCES;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ resource: string }> },
) {
  const { resource } = await params;

  if (!(resource in RESOURCES)) {
    return NextResponse.json(
      { error: `Unknown resource '${resource}'`, available: Object.keys(RESOURCES) },
      { status: 404 },
    );
  }

  return NextResponse.json({
    resource,
    data: RESOURCES[resource as Resource](),
    demo: true,
  });
}
