import type { Metadata } from "next";
import { Card, CardHeader, DemoNote, Pill, Table, Td, Tr } from "@/components/admin/ui";
import ProductImage from "@/components/brand/ProductImage";
import { fetchProducts } from "@/data/catalog.queries";
import { formatRM } from "@/lib/format";

export const metadata: Metadata = {
  title: "Products · Admin",
  description: "One Kalima catalog synced across web, Shopee and TikTok Shop.",
};

/*
  Server Component. Catalog and stock now come from Supabase — stock is the sum
  of stock_on_hand across the product's variants, so the "low" flag reflects
  real inventory rather than a hardcoded table.
*/
export default async function AdminProductsPage() {
  const products = await fetchProducts();

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl text-navy">Products</h1>
          <p className="mt-1 text-[13px] tracking-wide text-navy-400">
            One catalog, three channels — stock is ledger-tracked and synced to Shopee &amp; TikTok Shop.
          </p>
        </div>
        <button className="label-caps bg-navy px-5 py-2.5 text-white hover:bg-navy-700 transition-colors cursor-pointer">
          + Add Product
        </button>
      </div>

      <Card>
        <CardHeader title={`${products.length} products`} />
        <Table head={["Product", "Price", "Variants", "Stock", "Status", "Channels"]}>
          {products.map((p) => {
            const stock = p.stock ?? 0;
            return (
              <Tr key={p.id}>
                <Td>
                  <div className="flex items-center gap-3">
                    {p.image ? (
                      <ProductImage
                        image={p.image}
                        tone={p.tone}
                        alt=""
                        className="h-12 w-10 shrink-0"
                        position="center top"
                        sizes="40px"
                      />
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
              </Tr>
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
