"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveProduct } from "@/app/admin/actions";
import { Card, CardHeader } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ProductForEdit } from "@/lib/admin";

type Category = "women" | "men" | "accessories";

const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/*
  Create / edit form for a product. Money is collected in RM and converted to
  integer sen before hitting saveProduct. On create the form redirects to the
  new product's editor so variants can be added; on edit it stays put.
*/
export function ProductForm({ product }: { product?: ProductForEdit }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isEdit = Boolean(product);

  const [name, setName] = useState(product?.name ?? "");
  const [slug, setSlug] = useState(product?.slug ?? "");
  // Track whether the user has hand-edited the slug — until then keep it in
  // sync with the name so new products get a sensible auto-suggested slug.
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [description, setDescription] = useState(product?.description ?? "");
  const [fabric, setFabric] = useState(product?.fabric ?? "");
  const [category, setCategory] = useState<Category>(product?.category ?? "women");
  const [price, setPrice] = useState(product ? String(product.priceSen / 100) : "");
  // Blank = not on sale. Kept as a string so clearing the box clears the sale.
  const [salePrice, setSalePrice] = useState(
    product?.salePriceSen != null ? String(product.salePriceSen / 100) : "",
  );
  const [bestSeller, setBestSeller] = useState(product?.bestSeller ?? false);
  const [newArrival, setNewArrival] = useState(product?.newArrival ?? false);
  const [tone, setTone] = useState(product?.tone ?? "#383c61");
  const [published, setPublished] = useState(product?.published ?? true);
  const [offersCustomSizing, setOffersCustomSizing] = useState(
    product?.offersCustomSizing ?? false,
  );

  function onNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  function submit() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Name is required.");
      return;
    }
    const ringgit = Number(price);
    if (!Number.isFinite(ringgit) || ringgit < 0) {
      toast.error("Enter a valid price.");
      return;
    }
    const priceSen = Math.round(ringgit * 100);

    let salePriceSen: number | null = null;
    if (salePrice.trim()) {
      const saleRinggit = Number(salePrice);
      if (!Number.isFinite(saleRinggit) || saleRinggit < 0) {
        toast.error("Enter a valid sale price, or leave it empty.");
        return;
      }
      salePriceSen = Math.round(saleRinggit * 100);
      if (salePriceSen >= priceSen) {
        toast.error("The sale price must be below the normal price.");
        return;
      }
    }

    startTransition(async () => {
      const res = await saveProduct({
        id: product?.id,
        name: trimmedName,
        slug: slug.trim() || trimmedName,
        description,
        fabric,
        category,
        priceSen,
        salePriceSen,
        bestSeller,
        newArrival,
        tone,
        published,
        offersCustomSizing,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      if (isEdit) {
        toast.success("Product saved.");
        router.refresh();
      } else {
        toast.success("Product created — add variants below.");
        router.push(`/admin/products/${res.slug}`);
      }
    });
  }

  return (
    <Card>
      <CardHeader title={isEdit ? "Product details" : "New product"} />
      <div className="space-y-5 p-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pf-name" className="label-caps text-navy-400">
              Name
            </Label>
            <Input
              id="pf-name"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Aisyah Abaya"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pf-slug" className="label-caps text-navy-400">
              Slug
            </Label>
            <Input
              id="pf-slug"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              placeholder="aisyah-abaya"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="pf-description" className="label-caps text-navy-400">
            Description
          </Label>
          <Textarea
            id="pf-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A flowing, everyday abaya in a soft crepe…"
            rows={4}
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="pf-fabric" className="label-caps text-navy-400">
              Fabric
            </Label>
            <Input
              id="pf-fabric"
              value={fabric}
              onChange={(e) => setFabric(e.target.value)}
              placeholder="Nidha crepe"
            />
          </div>
          <div className="space-y-2">
            <Label className="label-caps text-navy-400">Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="women">Women</SelectItem>
                <SelectItem value="men">Men</SelectItem>
                <SelectItem value="accessories">Accessories</SelectItem>
              </SelectContent>
            </Select>
            {/* The dropdown IS the assignment — there is no separate collection
                picker, and asking for one is how this hint came to exist. */}
            <p className="text-[11px] tracking-wide text-navy-400">
              Decides which shop page lists it: Women, Men or Accessories.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pf-price" className="label-caps text-navy-400">
              Base price (RM)
            </Label>
            <Input
              id="pf-price"
              type="number"
              min={0}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="299.00"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pf-sale-price" className="label-caps text-navy-400">
              Sale price (RM)
            </Label>
            <Input
              id="pf-sale-price"
              type="number"
              min={0}
              step="0.01"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              placeholder="Not on sale"
            />
            <p className="text-[11px] tracking-wide text-navy-400">
              {salePrice.trim() && Number(salePrice) > 0 && Number(price) > Number(salePrice)
                ? `${Math.round((1 - Number(salePrice) / Number(price)) * 100)}% off — shoppers see RM${price} struck through.`
                : "Leave empty for no sale."}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="pf-tone" className="label-caps text-navy-400">
            Tone (swatch colour)
          </Label>
          <div className="flex items-center gap-3">
            <span
              className="size-9 shrink-0 rounded-md border border-navy/10"
              style={{ background: tone }}
              aria-hidden
            />
            <Input
              id="pf-tone"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              placeholder="#383c61"
              className="max-w-40 font-mono"
            />
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(tone) ? tone : "#383c61"}
              onChange={(e) => setTone(e.target.value)}
              className="size-9 cursor-pointer rounded-md border border-navy/10 bg-transparent p-0.5"
              aria-label="Pick tone colour"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-6 pt-1">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-navy">
            <input
              type="checkbox"
              checked={bestSeller}
              onChange={(e) => setBestSeller(e.target.checked)}
              className="size-4 accent-navy"
            />
            Best seller
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-navy">
            <input
              type="checkbox"
              checked={newArrival}
              onChange={(e) => setNewArrival(e.target.checked)}
              className="size-4 accent-navy"
            />
            New arrival
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-navy">
            <input
              type="checkbox"
              checked={published}
              onChange={(e) => setPublished(e.target.checked)}
              className="size-4 accent-navy"
            />
            Published
          </label>
          <label
            className="flex cursor-pointer items-center gap-2 text-[13px] text-navy"
            title="Shows a Custom sizing link beside the size guide on this product's page."
          >
            <input
              type="checkbox"
              checked={offersCustomSizing}
              onChange={(e) => setOffersCustomSizing(e.target.checked)}
              className="size-4 accent-navy"
            />
            Offer custom sizing
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-navy/10 pt-4">
          <Button variant="kalima" size="sm" className="cursor-pointer" onClick={submit} disabled={pending}>
            {pending ? "Saving…" : isEdit ? "Save changes" : "Create product"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
