import type { Metadata } from "next";
import OrdersBrowser from "@/components/admin/OrdersBrowser";
import { DemoNote } from "@/components/admin/ui";
import { ORDERS } from "@/data/demo";

export const metadata: Metadata = {
  title: "Orders · Admin",
  description: "Web and marketplace orders in a single Kalima back-office list.",
};

/*
  Server Component. Only the channel filter needs state, so it lives in the
  OrdersBrowser island; the heading and demo note stay static HTML.
*/
export default function AdminOrdersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-navy">Orders</h1>
        <p className="mt-1 text-[13px] tracking-wide text-navy-400">
          Web + marketplace orders in one list. Marketplace fulfilment stays in Seller Center; web orders ship via
          EasyParcel.
        </p>
      </div>

      <OrdersBrowser allOrders={ORDERS} />

      <DemoNote>
        Demo data. In production this list streams live from Supabase — web checkout orders plus Shopee/TikTok
        orders imported by webhook (Phase 8). “Book shipment” opens the EasyParcel flow shown under Shipping ④.
      </DemoNote>
    </div>
  );
}
