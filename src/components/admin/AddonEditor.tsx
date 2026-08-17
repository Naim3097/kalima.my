"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  addProductAddon,
  removeProductAddon,
  updateProductAddon,
} from "@/app/admin/actions";
import { Card, CardHeader } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AddonCandidate, EditAddon } from "@/lib/admin";

/*
  Matching pieces offered on this product's page — "Matching Palazzo Pants".

  WHAT THIS DOES NOT DO is as important as what it does. It never sets a price,
  a SKU or a stock figure, because an add-on is a whole product that already
  has all three. This card only records "offer that product alongside this one,
  in that colourway", and the PDP resolves the rest at render time.

  The SIZE is never configured: an add-on is offered in whatever size the
  shopper picks on the parent, which is the entire meaning of "matching". Only
  the colourway is pinned, because that is a merchandising judgement a Cherry
  abaya paired with Black pants would otherwise get wrong.
*/
export function AddonEditor({
  productId,
  productSlug,
  addons,
  candidates,
}: {
  productId: string;
  productSlug: string;
  addons: EditAddon[];
  candidates: AddonCandidate[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [search, setSearch] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [pickedColor, setPickedColor] = useState<string>("");
  const [label, setLabel] = useState("");

  /* Already-linked products drop out of the picker — the pair is uniquely
     indexed, so offering them would only produce a save that fails. */
  const linked = useMemo(() => new Set(addons.map((a) => a.addonProductId)), [addons]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates
      .filter((c) => !linked.has(c.id))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.slug.includes(q))
      .slice(0, 8);
  }, [candidates, linked, search]);

  const picked = candidates.find((c) => c.id === pickedId) ?? null;

  function reset() {
    setPickedId(null);
    setPickedColor("");
    setLabel("");
    setSearch("");
  }

  function link() {
    if (!pickedId) return;
    startTransition(async () => {
      const res = await addProductAddon({
        parentProductId: productId,
        parentSlug: productSlug,
        addonProductId: pickedId,
        colorName: pickedColor || null,
        label: label || null,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Add-on linked.");
      reset();
      router.refresh();
    });
  }

  function patch(id: string, changes: { colorName?: string | null; active?: boolean }) {
    startTransition(async () => {
      const res = await updateProductAddon({ id, parentSlug: productSlug, ...changes });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await removeProductAddon(id, productSlug);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Add-on removed.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader title="Matching add-ons" />

      <div className="space-y-5 px-5 py-5">
        <p className="max-w-2xl text-[13px] leading-relaxed tracking-wide text-navy-400">
          Offered as tick boxes on this product&rsquo;s page. Each one is a separate product with
          its own price and stock — shoppers get it in the{" "}
          <span className="text-navy">same size</span> they pick here, in the colourway you pin
          below.
        </p>

        {/* ---- Linked ---- */}
        {addons.length > 0 ? (
          <div className="divide-y divide-navy/10 rounded border border-navy/10">
            {addons.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-48 flex-1">
                  <p className="text-[13px] text-navy">{a.label ?? a.productName}</p>
                  <p className="text-[11px] tracking-wide text-navy-400">
                    {a.label ? `${a.productName} · ` : ""}
                    {a.slug}
                  </p>
                </div>

                <label className="flex items-center gap-2 text-[12px] text-navy-400">
                  Colour
                  <select
                    value={a.colorName ?? ""}
                    disabled={pending}
                    onChange={(e) => patch(a.id, { colorName: e.target.value || null })}
                    className="cursor-pointer rounded border border-navy/20 bg-white px-2 py-1 text-[12px] text-navy"
                  >
                    {/* Empty = "first colourway", which is what a single-colour
                        add-on wants and needs no decision. */}
                    <option value="">First colourway</option>
                    {a.colors.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex cursor-pointer items-center gap-2 text-[12px] text-navy">
                  <input
                    type="checkbox"
                    checked={a.active}
                    disabled={pending}
                    onChange={(e) => patch(a.id, { active: e.target.checked })}
                    className="size-4 accent-navy"
                  />
                  Shown
                </label>

                <Button
                  type="button"
                  variant="kalimaOutline"
                  size="sm"
                  disabled={pending}
                  onClick={() => remove(a.id)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded border border-dashed border-navy-200 px-4 py-6 text-center">
            <p className="text-[13px] tracking-wide text-navy">No add-ons linked</p>
            <p className="mt-1 text-[11px] tracking-wide text-navy-400">
              The Add ons section is hidden on the product page until one is linked.
            </p>
          </div>
        )}

        {/* ---- Link a new one ---- */}
        <div className="space-y-3 border-t border-navy/10 pt-5">
          {!picked ? (
            <>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products to link…"
                className="max-w-sm"
              />
              {search.trim() && (
                <div className="max-w-sm divide-y divide-navy/10 rounded border border-navy/10">
                  {matches.length ? (
                    matches.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setPickedId(c.id);
                          setPickedColor("");
                        }}
                        className="block w-full cursor-pointer px-3 py-2 text-left hover:bg-cream-50"
                      >
                        <span className="text-[13px] text-navy">{c.name}</span>
                        <span className="block text-[11px] tracking-wide text-navy-400">
                          {c.colors.length
                            ? c.colors.join(", ")
                            : "No variants yet — add colours before linking"}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-2 text-[12px] tracking-wide text-navy-400">
                      No products match that search.
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <p className="label-caps mb-1 text-[10px] text-navy-400">Product</p>
                <p className="text-[13px] text-navy">{picked.name}</p>
              </div>

              <label className="text-[12px] text-navy-400">
                <span className="label-caps mb-1 block text-[10px]">Colourway</span>
                <select
                  value={pickedColor}
                  onChange={(e) => setPickedColor(e.target.value)}
                  className="cursor-pointer rounded border border-navy/20 bg-white px-2 py-1.5 text-[12px] text-navy"
                >
                  <option value="">First colourway</option>
                  {picked.colors.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-[12px] text-navy-400">
                <span className="label-caps mb-1 block text-[10px]">Label (optional)</span>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={`Matching ${picked.name}`}
                  className="w-64"
                />
              </label>

              <Button
                type="button"
                variant="kalima"
                size="sm"
                disabled={pending}
                onClick={link}
              >
                {pending ? "Linking…" : "Link add-on"}
              </Button>
              <Button type="button" variant="kalimaOutline" size="sm" onClick={reset}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
