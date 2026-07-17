import { Card, CardHeader, Table, Td, Pill, DemoNote } from "../../components/admin/ui";
import { PRODUCTS } from "../../data/catalog";
import { formatRM } from "../../lib/format";

const STOCK: Record<string, number> = {
  p1: 32, p2: 24, p3: 15, p4: 41, p5: 142, p6: 58, p7: 27, p8: 19, p9: 12, p10: 33, p11: 8, p12: 19, p13: 11,
};

export default function AdminProducts() {
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl text-navy">Products</h1>
          <p className="mt-1 text-[13px] tracking-wide text-navy-400">
            One catalog, three channels — stock is ledger-tracked and synced to Shopee & TikTok Shop.
          </p>
        </div>
        <button className="label-caps bg-navy px-5 py-2.5 text-white hover:bg-navy-700 transition-colors cursor-pointer">
          + Add Product
        </button>
      </div>

      <Card>
        <CardHeader title={`${PRODUCTS.length} products`} />
        <Table head={["Product", "Price", "Variants", "Stock", "Status", "Channels"]}>
          {PRODUCTS.map((p) => {
            const stock = STOCK[p.id] ?? 20;
            return (
              <tr key={p.id} className="hover:bg-cream-50">
                <Td>
                  <div className="flex items-center gap-3">
                    {p.image ? (
                      <img src={p.image} alt="" className="h-12 w-10 object-cover object-top" />
                    ) : (
                      <div className="h-12 w-10" style={{ background: p.tone }} />
                    )}
                    <div>
                      <p className="font-medium">{p.name}</p>
                      <p className="text-[11px] uppercase tracking-wider text-navy-300">
                        {p.collection ? `${p.collection} · ` : ""}
                        {p.category}
                      </p>
                    </div>
                  </div>
                </Td>
                <Td>{formatRM(p.price)}</Td>
                <Td className="text-navy-400">
                  {p.colors.length} colours × {p.sizes.length} sizes
                </Td>
                <Td className={stock <= 10 ? "font-medium text-red-700" : ""}>
                  {stock}
                  {stock <= 10 && <span className="ml-2 text-[10px] uppercase tracking-wider">low</span>}
                </Td>
                <Td>
                  <Pill value="active" />
                </Td>
                <Td className="text-[11px] tracking-wide text-navy-400">Web · Shopee · TikTok</Td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <DemoNote>
        Demo view. Full product editor (variant matrix, image manager, CSV import/export, stock adjustment with
        reasons) is a Phase 3 deliverable backed by Supabase.
      </DemoNote>
    </div>
  );
}
