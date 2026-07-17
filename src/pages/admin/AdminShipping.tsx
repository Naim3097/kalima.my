import { Card, CardHeader, StatCard, Table, Td, Pill, DemoNote } from "../../components/admin/ui";
import { SHIPMENTS, COURIER_QUOTES, ORDERS } from "../../data/demo";
import { formatRM } from "../../lib/format";

export default function AdminShipping() {
  const awaiting = ORDERS.filter((o) => o.channel === "web" && o.status === "paid");

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl text-navy">Shipping · EasyParcel ④</h1>
          <p className="mt-1 text-[13px] tracking-wide text-navy-400">
            Live courier rates at checkout, one-click consignment booking, AWB labels and tracking that notifies
            customers automatically.
          </p>
        </div>
        <div className="text-right">
          <p className="label-caps text-navy-400">EasyParcel credit</p>
          <p className="font-display text-2xl text-navy">RM238.40</p>
          <button className="text-[12px] tracking-wide text-navy-400 underline underline-offset-4 hover:text-navy cursor-pointer">
            Top up
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Awaiting booking" value={String(awaiting.length)} sub="Paid web orders without AWB" />
        <StatCard label="In transit" value="1" sub="Auto-tracked via webhook" />
        <StatCard label="Avg shipping cost (30d)" value="RM8.72" sub="Cheapest-courier auto-selection" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Booking flow */}
        <Card>
          <CardHeader title={`Book shipment — ${awaiting[0]?.id ?? "KLM-10248"}`} />
          <div className="px-5 py-5">
            <div className="mb-4 flex items-start justify-between text-[13px]">
              <div>
                <p className="font-medium text-navy">{awaiting[0]?.customer ?? "Nurul Aisyah"}</p>
                <p className="mt-0.5 text-navy-400">12, Jalan Setia 3/2, 40170 Shah Alam, Selangor</p>
              </div>
              <p className="text-navy-400">Parcel: 0.8 kg</p>
            </div>
            <p className="label-caps mb-2 text-navy-400">Live quotes</p>
            <div className="space-y-2">
              {COURIER_QUOTES.map((q, i) => (
                <label
                  key={q.courier}
                  className={`flex cursor-pointer items-center justify-between border px-4 py-3 text-[13px] transition-colors ${
                    i === 0 ? "border-navy bg-navy-100/40" : "border-navy/15 hover:border-navy/40"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span className={`h-3 w-3 rounded-full border ${i === 0 ? "border-navy bg-navy" : "border-navy/30"}`} />
                    <span className="font-medium text-navy">{q.courier}</span>
                    <span className="text-navy-400">{q.eta}</span>
                  </span>
                  <span className="text-navy">{formatRM(q.price)}</span>
                </label>
              ))}
            </div>
            <button className="label-caps mt-4 w-full bg-navy px-4 py-3 text-white hover:bg-navy-700 transition-colors cursor-pointer">
              Book with J&T — RM8.90 · Download AWB
            </button>
          </div>
        </Card>

        {/* Shipments */}
        <Card>
          <CardHeader title="Recent shipments" />
          <Table head={["Order", "Customer", "Destination", "Courier", "AWB", "Status"]}>
            {SHIPMENTS.map((s) => (
              <tr key={s.awb} className="hover:bg-cream-50">
                <Td className="font-medium">{s.order}</Td>
                <Td>{s.customer}</Td>
                <Td className="text-navy-400">{s.destination}</Td>
                <Td>{s.courier}</Td>
                <Td className="text-navy-400">{s.awb}</Td>
                <Td>
                  <Pill value={s.status} />
                </Td>
              </tr>
            ))}
          </Table>
          <div className="border-t border-navy/10 px-5 py-4">
            <p className="label-caps mb-3 text-navy-400">Tracking timeline — EP934812734MY</p>
            <ol className="space-y-2 text-[13px]">
              {[
                ["17 Jul, 08:12", "Departed sorting hub — Shah Alam", true],
                ["16 Jul, 21:40", "Arrived at sorting hub — Bukit Raja", true],
                ["16 Jul, 15:05", "Picked up by J&T Express", true],
                ["16 Jul, 14:00", "AWB generated, customer notified via WhatsApp", true],
              ].map(([time, event]) => (
                <li key={time as string} className="flex gap-3">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-navy" />
                  <div>
                    <p className="text-navy">{event}</p>
                    <p className="text-[11px] text-navy-300">{time}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </Card>
      </div>

      <DemoNote>
        Demo preview of Phase 4. Requires the client's EasyParcel account + API key (§8 of the plan). Checkout
        quotes, booking, AWB PDFs and tracking webhooks all run through Supabase Edge Functions — customers get
        automatic “order shipped” WhatsApp/email with a live tracking link.
      </DemoNote>
    </div>
  );
}
