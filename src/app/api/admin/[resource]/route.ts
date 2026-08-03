import { NextResponse } from "next/server";
import {
  ORDERS,
  CUSTOMERS,
  CAMPAIGNS,
  AFFILIATES,
  TIERS,
  SHIPMENTS,
  CONVERSATIONS,
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
  // 'sync' is gone: Phase 8 landed, so /admin/sync reads the real tables and
  // its fixtures were deleted. 'inbox' is the last one still backed by demo
  // data, and goes the same way when Phase 9 lands.
  inbox: () => CONVERSATIONS,
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
