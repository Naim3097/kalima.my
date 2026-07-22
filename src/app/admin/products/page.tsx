import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader, Pill, Table, Td, Tr } from "@/components/admin/ui";
import ProductImage from "@/components/brand/ProductImage";
import { Button } from "@/components/ui/button";
import { fetchProducts } from "@/data/catalog.queries";
import { formatRM } from "@/lib/format";

export const metadata: Metadata = {
  title: "Products · Admin",
  description: "Kalima catalog — edit products, variants and ledger-tracked stock.",
};

/*
  Server Component. Catalog and stock come from Supabase — stock is the sum of
  stock_on_hand across the product's variants, so the "low" flag reflects real
  inventory. Each row links into the product editor.
*/
export default async function AdminProductsPage() {
  const products = await fetchProducts();

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl text-navy">Products</h1>
          <p className="mt-1 text-[13px] tracking-wide text-navy-400">
            One catalog — stock is ledger-tracked and adjusted with a reason for every change.
          </p>
        </div>
        <Button asChild variant="kalima" size="editorial" className="cursor-pointer px-5 py-2.5">
          <Link href="/admin/products/new">+ Add Product</Link>
        </Button>
      </div>

      <Card>
        <CardHeader title={`${products.length} products`} />
        <Table head={["Product", "Price", "Variants", "Stock", "Status", ""]}>
          {products.map((p) => {
            const stock = p.stock ?? 0;
            return (
              <Tr key={p.id}>
                <Td>
                  <Link href={`/admin/products/${p.slug}`} className="flex items-center gap-3 group">
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
                      <p className="font-medium group-hover:underline">{p.name}</p>
                      <p className="text-[11px] uppercase tracking-wider text-navy-300">
                        {p.collection ? `${p.collection} · ` : ""}
                        {p.category}
                      </p>
                    </div>
                  </Link>
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
                <Td>
                  <Link
                    href={`/admin/products/${p.slug}`}
                    className="label-caps text-[11px] text-navy-400 hover:text-navy"
                  >
                    Edit
                  </Link>
                </Td>
              </Tr>
            );
          })}
        </Table>
      </Card>
    </div>
  );
}
