import { useState } from "react";
import { Card, CardHeader, Table, Td, Pill, ChannelBadge, DemoNote } from "../../components/admin/ui";
import { ORDERS, type Channel } from "../../data/demo";
import { formatRM } from "../../lib/format";

const FILTERS: { label: string; value: Channel | "all" }[] = [
  { label: "All channels", value: "all" },
  { label: "kalima.my", value: "web" },
  { label: "Shopee", value: "shopee" },
  { label: "TikTok Shop", value: "tiktok" },
];

export default function AdminOrders() {
  const [filter, setFilter] = useState<Channel | "all">("all");
  const orders = ORDERS.filter((o) => filter === "all" || o.channel === filter);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-navy">Orders</h1>
        <p className="mt-1 text-[13px] tracking-wide text-navy-400">
          Web + marketplace orders in one list. Marketplace fulfilment stays in Seller Center; web orders ship via
          EasyParcel.
        </p>
      </div>

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`label-caps px-4 py-2 transition-colors cursor-pointer ${
              filter === f.value ? "bg-navy text-white" : "border border-navy/20 text-navy-400 hover:border-navy hover:text-navy"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader title={`${orders.length} orders`} />
        <Table head={["Order", "Date", "Customer", "Channel", "Items", "Total", "Status", "Shipping", ""]}>
          {orders.map((o) => (
            <tr key={o.id} className="hover:bg-cream-50">
              <Td className="font-medium">{o.id}</Td>
              <Td className="text-navy-400">{o.date}</Td>
              <Td>{o.customer}</Td>
              <Td>
                <ChannelBadge channel={o.channel} />
              </Td>
              <Td className="max-w-52 truncate">{o.items}</Td>
              <Td>{formatRM(o.total)}</Td>
              <Td>
                <Pill value={o.status} />
              </Td>
              <Td className="text-navy-400">
                {o.tracking ? (
                  <span title={o.courier}>{o.tracking}</span>
                ) : o.channel !== "web" ? (
                  <span className="text-navy-300">Seller Center</span>
                ) : o.status === "paid" ? (
                  <span className="text-amber-700">Awaiting booking</span>
                ) : (
                  "—"
                )}
              </Td>
              <Td>
                {o.channel === "web" && o.status === "paid" && (
                  <button className="label-caps border border-navy/30 px-3 py-1.5 text-navy hover:border-navy transition-colors cursor-pointer">
                    Book shipment
                  </button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <DemoNote>
        Demo data. In production this list streams live from Supabase — web checkout orders plus Shopee/TikTok
        orders imported by webhook (Phase 8). “Book shipment” opens the EasyParcel flow shown under Shipping ④.
      </DemoNote>
    </div>
  );
}
