import { Card, CardHeader, Table, Td, Pill, DemoNote } from "../../components/admin/ui";
import { SYNC_ROWS, SYNC_LOG } from "../../data/demo";

export default function AdminSync() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-navy">Marketplace Sync ⑤</h1>
        <p className="mt-1 text-[13px] tracking-wide text-navy-400">
          One stock pool across kalima.my, Shopee and TikTok Shop — a sale anywhere updates everywhere, no more
          oversell.
        </p>
      </div>

      {/* Connections */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-navy">Shopee</p>
              <p className="text-[12px] text-navy-400">kalima.os — MY</p>
            </div>
            <Pill value="active" />
          </div>
          <p className="mt-3 text-[12px] text-navy-300">Last webhook 2 min ago · token healthy</p>
        </Card>
        <Card className="px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-navy">TikTok Shop</p>
              <p className="text-[12px] text-navy-400">KALIMA Official</p>
            </div>
            <Pill value="active" />
          </div>
          <p className="mt-3 text-[12px] text-navy-300">Last webhook 14 min ago · token healthy</p>
        </Card>
        <Card className="px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-navy">Safety buffer</p>
              <p className="text-[12px] text-navy-400">Held back per marketplace listing</p>
            </div>
            <span className="font-display text-2xl text-navy">2 units</span>
          </div>
          <p className="mt-3 text-[12px] text-navy-300">Reconciliation poll every 15 min</p>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="SKU mapping & live stock"
          action={
            <button className="label-caps border border-navy/30 px-3 py-1.5 text-navy hover:border-navy transition-colors cursor-pointer">
              Re-sync all
            </button>
          }
        />
        <Table head={["SKU", "Product", "kalima.my", "Shopee", "TikTok Shop", "Status"]}>
          {SYNC_ROWS.map((r) => (
            <tr key={r.sku} className="hover:bg-cream-50">
              <Td>
                <code className="rounded bg-navy-100 px-2 py-1 text-[11px] text-navy">{r.sku}</code>
              </Td>
              <Td>
                <div className="flex items-center gap-3">
                  {r.image && <img src={r.image} alt="" className="h-10 w-8 object-cover object-top" />}
                  <span className="max-w-64 truncate">{r.product}</span>
                </div>
              </Td>
              <Td className="font-medium">{r.web}</Td>
              <Td>{r.shopee ?? <span className="text-navy-300">—</span>}</Td>
              <Td>
                {r.tiktok ?? (
                  <button className="text-[12px] text-amber-700 underline underline-offset-4 cursor-pointer">
                    Map listing
                  </button>
                )}
              </Td>
              <Td>
                <Pill value={r.synced ? "synced" : "attention"} />
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card>
        <CardHeader title="Sync activity — today" />
        <ul className="divide-y divide-navy/5 px-5">
          {SYNC_LOG.map((l) => (
            <li key={l.time + l.event} className="flex items-start gap-3 py-3 text-[13px]">
              <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${l.ok ? "bg-emerald-500" : "bg-red-500"}`} />
              <div>
                <p className="text-navy">{l.event}</p>
                <p className="text-[11px] text-navy-300">{l.time}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <DemoNote>
        Demo preview of Phase 8. Requires Shopee Open Platform + TikTok Shop Partner Center app approvals
        (1–4 weeks — applications start during Phase 3). Website Postgres is the source of truth; every movement
        goes through the stock ledger, webhook-first with a 15-minute reconciliation poll as the safety net.
      </DemoNote>
    </div>
  );
}
