"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { bulkUpdateProducts, type BulkProductPatch } from "@/app/admin/actions";
import { Card, CardHeader, Pill, Table, Td, Tr } from "@/components/admin/ui";
import ProductImage from "@/components/brand/ProductImage";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatRM } from "@/lib/format";
import type { AdminProductRow } from "@/lib/admin";

type Props = { products: AdminProductRow[] };

const NONE = "__none__"; // Select cannot hold an empty string as a value

/*
  The catalog table, with bulk edit.

  Selection lives here rather than in the URL: it is a scratch gesture, not a
  place worth linking to, and a checkbox that survived a refresh would be a
  surprising way to apply a price change to nine products.

  The bar only ever sends the fields that were touched — see BulkProductPatch —
  so "publish these" cannot quietly carry a stale category along with it.
*/
export function ProductsTable({ products }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allSelected = products.length > 0 && selected.size === products.length;
  const someSelected = selected.size > 0 && !allSelected;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(products.map((p) => p.id)));
  }

  function apply(patch: BulkProductPatch, describe: string) {
    const ids = [...selected];
    startTransition(async () => {
      const res = await bulkUpdateProducts(ids, patch);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      const failed = res.failed ?? [];
      toast.success(`${res.updated} product(s) ${describe}.`, {
        description: failed.length ? `Skipped: ${failed.join("; ")}` : undefined,
      });
      // Keep the selection — a bulk edit is usually followed by another one on
      // the same set (mark on sale, then publish).
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          pending={pending}
          onClear={() => setSelected(new Set())}
          onApply={apply}
        />
      )}

      <Card>
        <CardHeader
          title={
            selected.size
              ? `${selected.size} of ${products.length} selected`
              : `${products.length} products`
          }
        />
        <Table
          head={[
            <Checkbox
              key="all"
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={toggleAll}
              aria-label="Select all products"
              className="border-navy/30 data-[state=checked]:border-navy data-[state=checked]:bg-navy"
            />,
            "Product",
            "Price",
            "Variants",
            "Stock",
            "Status",
            "",
          ]}
        >
          {products.map((p) => {
            const checked = selected.has(p.id);
            return (
              <Tr key={p.id} className={checked ? "bg-cream-50" : undefined}>
                <Td>
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggle(p.id)}
                    aria-label={`Select ${p.name}`}
                    className="border-navy/30 data-[state=checked]:border-navy data-[state=checked]:bg-navy"
                  />
                </Td>
                <Td>
                  <Link href={`/admin/products/${p.slug}`} className="group flex items-center gap-3">
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
                      <div className="h-12 w-10 shrink-0" style={{ background: p.tone }} />
                    )}
                    <div>
                      <p className="font-medium group-hover:underline">{p.name}</p>
                      <p className="text-[11px] uppercase tracking-wider text-navy-300">
                        {p.category}
                      </p>
                    </div>
                  </Link>
                </Td>
                <Td>
                  {p.salePriceSen != null ? (
                    <span className="flex items-baseline gap-2">
                      <span className="text-navy-300 line-through">{formatRM(p.priceSen / 100)}</span>
                      <span className="font-medium text-navy">{formatRM(p.salePriceSen / 100)}</span>
                    </span>
                  ) : (
                    formatRM(p.priceSen / 100)
                  )}
                </Td>
                <Td className="text-navy-400">
                  {p.colorCount} colours × {p.sizeCount} sizes
                </Td>
                <Td className={p.stock <= 10 ? "font-medium text-red-700" : ""}>
                  {p.stock}
                  {p.stock <= 10 && (
                    <span className="ml-2 text-[10px] uppercase tracking-wider">low</span>
                  )}
                </Td>
                <Td>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Pill value={p.published ? "active" : "draft"} />
                    {p.salePriceSen != null && <Pill value="on sale" />}
                  </span>
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

/*
  The bulk bar. Sticky, because the selection is made by scrolling the table
  and the controls have to stay reachable from wherever that ends.
*/
function BulkBar({
  count,
  pending,
  onClear,
  onApply,
}: {
  count: number;
  pending: boolean;
  onClear: () => void;
  onApply: (patch: BulkProductPatch, describe: string) => void;
}) {
  const [percent, setPercent] = useState("");
  const [fixed, setFixed] = useState("");
  const [category, setCategory] = useState(NONE);

  const noun = count === 1 ? "product" : "products";

  return (
    <Card className="sticky top-4 z-20 border-navy/20 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4 px-5 py-4">
        <p className="text-[13px] tracking-wide text-navy">
          <span className="font-medium">{count}</span> {noun} selected
        </p>

        <span className="flex flex-wrap items-center gap-2">
          <span className="label-caps !text-[10px] text-navy-400">Visibility</span>
          <Button
            variant="kalimaOutline"
            size="editorial"
            disabled={pending}
            onClick={() => onApply({ published: true }, "published")}
          >
            Publish
          </Button>
          <Button
            variant="kalimaOutline"
            size="editorial"
            disabled={pending}
            onClick={() => onApply({ published: false }, "unpublished")}
          >
            Unpublish
          </Button>
        </span>

        <span className="flex flex-wrap items-center gap-2">
          <span className="label-caps !text-[10px] text-navy-400">Flags</span>
          <Button
            variant="kalimaOutline"
            size="editorial"
            disabled={pending}
            onClick={() => onApply({ bestSeller: true }, "marked best seller")}
          >
            + Best seller
          </Button>
          <Button
            variant="kalimaOutline"
            size="editorial"
            disabled={pending}
            onClick={() => onApply({ bestSeller: false }, "cleared of best seller")}
          >
            −
          </Button>
          <Button
            variant="kalimaOutline"
            size="editorial"
            disabled={pending}
            onClick={() => onApply({ newArrival: true }, "marked new arrival")}
          >
            + New arrival
          </Button>
          <Button
            variant="kalimaOutline"
            size="editorial"
            disabled={pending}
            onClick={() => onApply({ newArrival: false }, "cleared of new arrival")}
          >
            −
          </Button>
        </span>

        <span className="flex flex-wrap items-center gap-2">
          <span className="label-caps !text-[10px] text-navy-400">Sale</span>
          <Input
            type="number"
            min={1}
            max={99}
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            placeholder="% off"
            className="h-8 w-20"
            aria-label="Percent off"
          />
          <Button
            variant="kalimaOutline"
            size="editorial"
            disabled={pending || !percent.trim()}
            onClick={() => {
              const pct = Number(percent);
              if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
                toast.error("Enter a discount between 1% and 99%.");
                return;
              }
              onApply({ sale: { kind: "percent", percent: pct } }, `put ${pct}% off`);
              setPercent("");
            }}
          >
            Apply % off
          </Button>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={fixed}
            onChange={(e) => setFixed(e.target.value)}
            placeholder="RM"
            className="h-8 w-24"
            aria-label="Fixed sale price in ringgit"
          />
          <Button
            variant="kalimaOutline"
            size="editorial"
            disabled={pending || !fixed.trim()}
            onClick={() => {
              const rm = Number(fixed);
              if (!Number.isFinite(rm) || rm < 0) {
                toast.error("Enter a valid sale price.");
                return;
              }
              onApply(
                { sale: { kind: "fixed", sen: Math.round(rm * 100) } },
                `set to ${formatRM(rm)}`,
              );
              setFixed("");
            }}
          >
            Set price
          </Button>
          <Button
            variant="kalimaOutline"
            size="editorial"
            disabled={pending}
            onClick={() => onApply({ sale: { kind: "clear" } }, "taken off sale")}
          >
            Clear sale
          </Button>
        </span>

        <span className="flex flex-wrap items-center gap-2">
          <span className="label-caps !text-[10px] text-navy-400">Category</span>
          <Select
            value={category}
            onValueChange={(v) => {
              setCategory(NONE);
              if (v !== NONE) {
                onApply(
                  { category: v as "women" | "men" | "accessories" },
                  `moved to ${v}`,
                );
              }
            }}
          >
            <SelectTrigger className="h-8 w-36 text-[12px]" disabled={pending}>
              <SelectValue placeholder="Move to…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Move to…</SelectItem>
              <SelectItem value="women">Women</SelectItem>
              <SelectItem value="men">Men</SelectItem>
              <SelectItem value="accessories">Accessories</SelectItem>
            </SelectContent>
          </Select>
        </span>

        <button
          type="button"
          onClick={onClear}
          disabled={pending}
          className="label-caps ml-auto cursor-pointer !text-[10px] text-navy-400 hover:text-navy disabled:opacity-50"
        >
          Clear selection
        </button>
      </div>
    </Card>
  );
}
