"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { addVariant, adjustStock, deleteVariant, setVariantWeight } from "@/app/admin/actions";
import { Card, CardHeader, Table, Td, Tr } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRM } from "@/lib/format";
import type { EditVariant } from "@/lib/admin";

type Props = {
  productId: string;
  productSlug: string;
  variants: EditVariant[];
};

/*
  Variant matrix for a product. Stock is NEVER edited as an absolute — each row
  submits a signed delta + reason through adjustStock, which is ledger-backed.
  Variant price overrides and the add form collect RM and convert to sen.
*/
export function VariantEditor({ productId, productSlug, variants }: Props) {
  return (
    <Card>
      <CardHeader title={`${variants.length} variants`} />
      <Table head={["SKU", "Colour", "Size", "Price", "Weight (g)", "Stock", "Adjust stock", ""]}>
        {variants.map((v) => (
          <VariantRow key={v.id} variant={v} productSlug={productSlug} />
        ))}
      </Table>
      <AddVariantForm productId={productId} productSlug={productSlug} variants={variants} />
    </Card>
  );
}

function VariantRow({ variant, productSlug }: { variant: EditVariant; productSlug: string }) {
  const [pending, startTransition] = useTransition();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");

  // Saved on blur — weight is a set-and-forget field, not worth a button.
  function saveWeight(raw: string) {
    const grams = Math.round(Number(raw));
    if (!Number.isFinite(grams) || grams < 0) {
      toast.error("Weight must be 0 or more grams.");
      return;
    }
    if (grams === variant.weightGrams) return;
    startTransition(async () => {
      const res = await setVariantWeight(variant.id, grams, productSlug);
      if ("error" in res) toast.error(res.error);
      else toast.success(`Weight set to ${grams} g.`);
    });
  }

  function apply() {
    const d = Number(delta);
    if (!Number.isInteger(d) || d === 0) {
      toast.error("Enter a non-zero whole number.");
      return;
    }
    startTransition(async () => {
      const res = await adjustStock(variant.id, d, reason.trim() || "manual adjustment", productSlug);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(`Stock updated — now ${res.newStock}.`);
      setDelta("");
      setReason("");
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await deleteVariant(variant.id, productSlug);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Variant deleted.");
    });
  }

  return (
    <Tr>
      <Td className="font-mono text-[11px] text-navy-400">{variant.sku}</Td>
      <Td>
        <span className="flex items-center gap-2">
          <span
            className="size-4 shrink-0 rounded-full border border-navy/10"
            style={{ background: variant.colorHex }}
            aria-hidden
          />
          {variant.colorName}
        </span>
      </Td>
      <Td>{variant.size}</Td>
      <Td className="text-navy-400">
        {variant.priceSen != null ? formatRM(variant.priceSen / 100) : "base"}
      </Td>
      <Td>
        {/* Courier rates price on weight, so this is editable inline. */}
        <Input
          type="number"
          step={1}
          min={0}
          defaultValue={variant.weightGrams}
          onBlur={(e) => saveWeight(e.target.value)}
          className="h-8 w-20 text-[12px]"
          aria-label={`Weight in grams for ${variant.sku}`}
        />
      </Td>
      <Td className={variant.stockOnHand <= 10 ? "font-medium text-red-700" : ""}>
        {variant.stockOnHand}
      </Td>
      <Td>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            step={1}
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            placeholder="±0"
            className="h-8 w-16"
            aria-label="Stock delta"
          />
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason"
            className="h-8 w-32"
            aria-label="Adjustment reason"
          />
          <Button
            variant="kalimaOutline"
            size="sm"
            className="cursor-pointer"
            onClick={apply}
            disabled={pending}
          >
            Apply
          </Button>
        </div>
      </Td>
      <Td>
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          aria-label="Delete variant"
          className="text-navy-300 transition-colors hover:text-red-700 disabled:opacity-50 cursor-pointer"
        >
          <Trash2 className="size-4" />
        </button>
      </Td>
    </Tr>
  );
}

function AddVariantForm({
  productId,
  productSlug,
  variants,
}: {
  productId: string;
  productSlug: string;
  variants: EditVariant[];
}) {
  const [pending, startTransition] = useTransition();
  const [colorName, setColorName] = useState("");
  const [colorHex, setColorHex] = useState("#cccccc");
  const [size, setSize] = useState("");
  const [sku, setSku] = useState("");
  const [priceRM, setPriceRM] = useState("");
  const [initialStock, setInitialStock] = useState("");

  function submit() {
    if (!colorName.trim() || !size.trim()) {
      toast.error("Colour and size are required.");
      return;
    }
    const priceSen = priceRM.trim() ? Math.round(Number(priceRM) * 100) : null;
    if (priceSen != null && (!Number.isFinite(priceSen) || priceSen < 0)) {
      toast.error("Enter a valid price override.");
      return;
    }
    const stock = initialStock.trim() ? Math.round(Number(initialStock)) : 0;

    // colorPosition: reuse an existing colour's index, else append after the
    // last distinct colour. position: 0 keeps the add simple.
    const distinctColors: string[] = [];
    for (const v of variants) {
      if (!distinctColors.includes(v.colorName.toLowerCase())) {
        distinctColors.push(v.colorName.toLowerCase());
      }
    }
    const existingIdx = distinctColors.indexOf(colorName.trim().toLowerCase());
    const colorPosition = existingIdx >= 0 ? existingIdx : distinctColors.length;

    startTransition(async () => {
      const res = await addVariant({
        productId,
        productSlug,
        colorName: colorName.trim(),
        colorHex,
        size: size.trim(),
        sku,
        priceSen,
        initialStock: stock,
        colorPosition,
        position: 0,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Variant added.");
      setColorName("");
      setColorHex("#cccccc");
      setSize("");
      setSku("");
      setPriceRM("");
      setInitialStock("");
    });
  }

  return (
    <div className="border-t border-navy/10 p-5">
      <h4 className="label-caps mb-3 !text-[11px] text-navy-400">Add variant</h4>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="space-y-1.5">
          <Label htmlFor="av-color" className="label-caps text-navy-400">
            Colour
          </Label>
          <Input
            id="av-color"
            value={colorName}
            onChange={(e) => setColorName(e.target.value)}
            placeholder="Sand"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="av-hex" className="label-caps text-navy-400">
            Hex
          </Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(colorHex) ? colorHex : "#cccccc"}
              onChange={(e) => setColorHex(e.target.value)}
              className="size-9 shrink-0 cursor-pointer rounded-md border border-navy/10 bg-transparent p-0.5"
              aria-label="Pick colour"
            />
            <Input
              id="av-hex"
              value={colorHex}
              onChange={(e) => setColorHex(e.target.value)}
              className="font-mono"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="av-size" className="label-caps text-navy-400">
            Size
          </Label>
          <Input id="av-size" value={size} onChange={(e) => setSize(e.target.value)} placeholder="M" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="av-sku" className="label-caps text-navy-400">
            SKU (optional)
          </Label>
          <Input
            id="av-sku"
            value={sku}
            onChange={(e) => setSku(e.target.value.toUpperCase())}
            placeholder="Auto"
            className="font-mono uppercase"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="av-price" className="label-caps text-navy-400">
            Price override (RM)
          </Label>
          <Input
            id="av-price"
            type="number"
            min={0}
            step="0.01"
            value={priceRM}
            onChange={(e) => setPriceRM(e.target.value)}
            placeholder="base"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="av-stock" className="label-caps text-navy-400">
            Initial stock
          </Label>
          <Input
            id="av-stock"
            type="number"
            min={0}
            step={1}
            value={initialStock}
            onChange={(e) => setInitialStock(e.target.value)}
            placeholder="0"
          />
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="kalima" size="sm" className="cursor-pointer" onClick={submit} disabled={pending}>
          {pending ? "Adding…" : "Add variant"}
        </Button>
      </div>
    </div>
  );
}
