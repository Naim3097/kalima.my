"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardHeader, Pill } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { importListingCsv, mapListing, unmapListing, updateListing } from "@/app/admin/actions";

/*
  SKU mapping and per-listing controls.

  Defaults to showing UNMAPPED rows first, because the screen exists to close
  gaps: a variant nobody has mapped is silently absent from a marketplace, and a
  full alphabetical list buries it. The filter makes that the default view
  rather than something you have to think to ask for.

  The quantity column shows what WOULD be pushed (stock minus buffer, floored at
  zero) next to raw stock, so the effect of a buffer is visible before it
  matters rather than after an oversell.
*/

type Cell = {
  listingId: string;
  externalItemId: string;
  externalModelId: string | null;
  safetyBuffer: number;
  syncEnabled: boolean;
  lastPushedQty: number | null;
};

type Row = {
  variantId: string;
  sku: string;
  productName: string;
  colorName: string;
  size: string;
  stockOnHand: number;
  listings: Record<string, Cell | undefined>;
};

const publishable = (stock: number, buffer: number) => Math.max(0, stock - Math.max(0, buffer));

export default function ListingMapper({
  rows,
  channels,
}: {
  rows: Row[];
  channels: { key: string; label: string }[];
}) {
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState<"unmapped" | "all">("unmapped");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ variantId: string; channel: string } | null>(null);
  const [itemId, setItemId] = useState("");
  const [modelId, setModelId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [importChannel, setImportChannel] = useState(channels[0]?.key ?? "");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const isUnmapped = channels.some((c) => !r.listings[c.key]);
      if (filter === "unmapped" && !isUnmapped) return false;
      if (!q) return true;
      return (
        r.sku.toLowerCase().includes(q) ||
        r.productName.toLowerCase().includes(q) ||
        `${r.colorName} ${r.size}`.toLowerCase().includes(q)
      );
    });
  }, [rows, channels, filter, search]);

  const unmappedCount = rows.filter((r) => channels.some((c) => !r.listings[c.key])).length;

  function save(variantId: string, channel: string) {
    start(async () => {
      const res = await mapListing({
        variantId,
        channel,
        externalItemId: itemId,
        externalModelId: modelId || undefined,
      });
      if ("error" in res) toast.error(res.error);
      else {
        toast.success("Listing mapped.");
        setEditing(null);
        setItemId("");
        setModelId("");
      }
    });
  }

  function remove(listingId: string) {
    start(async () => {
      const res = await unmapListing(listingId);
      if ("error" in res) toast.error(res.error);
      else toast.success("Mapping removed.");
    });
  }

  function setBuffer(listingId: string, value: string) {
    const n = Number.parseInt(value, 10);
    if (Number.isNaN(n)) return;
    start(async () => {
      const res = await updateListing({ listingId, safetyBuffer: n });
      if ("error" in res) toast.error(res.error);
      else toast.success("Buffer updated — a resync is queued.");
    });
  }

  function toggle(listingId: string, next: boolean) {
    start(async () => {
      const res = await updateListing({ listingId, syncEnabled: next });
      if ("error" in res) toast.error(res.error);
      else toast.success(next ? "Sync enabled." : "Sync paused for this listing.");
    });
  }

  function runImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) return toast.error("Choose a CSV first.");
    start(async () => {
      const text = await file.text();
      const res = await importListingCsv(importChannel, text);
      if ("error" in res) toast.error(res.error);
      else {
        toast.success(
          `Mapped ${res.mapped ?? 0} listing(s)${res.skipped ? `, ${res.skipped} skipped` : ""}.`,
        );
        if (res.problems?.length) console.warn("Listing import problems:", res.problems);
      }
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  return (
    <div className="space-y-4">
      {/* Bulk mapping — the path that works with no API access at all. */}
      <Card>
        <CardHeader title="Bulk map from a seller-centre export" />
        <div className="space-y-3 px-5 pb-5">
          <p className="text-[12px] leading-relaxed text-navy-400">
            Export your listings from the seller centre, then upload the file here. Rows are matched
            to variants by <strong>SKU</strong> — the file needs at least a <code>sku</code> and an{" "}
            <code>external_item_id</code> column, plus <code>external_model_id</code> where the
            listing has variations. Matching is on SKU only: guessing from a product name would
            silently point a listing at the wrong variant.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={importChannel}
              onChange={(e) => setImportChannel(e.target.value)}
              className="cursor-pointer border border-navy/20 bg-white px-3 py-2 text-[13px] text-navy"
            >
              {channels.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="cursor-pointer text-[12px] text-navy-400 file:mr-3 file:cursor-pointer file:border file:border-navy/20 file:bg-white file:px-3 file:py-1.5 file:text-[12px] file:text-navy"
            />
            <Button
              variant="kalimaOutline"
              size="editorial"
              className="cursor-pointer border-navy/30 px-3 py-1.5"
              disabled={pending}
              onClick={runImport}
            >
              {pending ? "Importing…" : "Import mappings"}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={`SKU mapping & live stock — ${unmappedCount} variant(s) not fully mapped`}
          action={
            <div className="flex items-center gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search SKU or product"
                className="h-8 w-48 text-[12px]"
              />
              <button
                onClick={() => setFilter(filter === "unmapped" ? "all" : "unmapped")}
                className="label-caps cursor-pointer border border-navy/30 px-3 py-1.5 text-[10px] text-navy transition-colors hover:border-navy"
              >
                {filter === "unmapped" ? "Showing unmapped" : "Showing all"}
              </button>
            </div>
          }
        />

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-navy/10">
                {["SKU", "Product", "Web stock", ...channels.map((c) => c.label)].map((h) => (
                  <th key={h} className="label-caps px-5 py-3 !text-[10px] font-medium text-navy-400">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-navy/5 text-navy">
              {visible.length === 0 && (
                <tr>
                  <td colSpan={3 + channels.length} className="px-5 py-8 text-center text-navy-300">
                    {filter === "unmapped"
                      ? "Every variant is mapped on every channel."
                      : "No variants match that search."}
                  </td>
                </tr>
              )}
              {visible.map((r) => (
                <tr key={r.variantId} className="hover:bg-cream-50">
                  <td className="px-5 py-3">
                    <code className="rounded bg-navy-100 px-2 py-1 text-[11px]">{r.sku}</code>
                  </td>
                  <td className="max-w-56 truncate px-5 py-3">
                    {r.productName}
                    <span className="text-navy-300"> · {r.colorName} / {r.size}</span>
                  </td>
                  <td className="px-5 py-3 font-medium">{r.stockOnHand}</td>

                  {channels.map((c) => {
                    const cell = r.listings[c.key];
                    const isEditing =
                      editing?.variantId === r.variantId && editing?.channel === c.key;

                    if (isEditing) {
                      return (
                        <td key={c.key} className="px-5 py-3">
                          <div className="flex flex-col gap-1.5">
                            <Input
                              autoFocus
                              value={itemId}
                              onChange={(e) => setItemId(e.target.value)}
                              placeholder="item id"
                              className="h-7 w-32 text-[12px]"
                            />
                            <Input
                              value={modelId}
                              onChange={(e) => setModelId(e.target.value)}
                              placeholder="model id (optional)"
                              className="h-7 w-32 text-[12px]"
                            />
                            <div className="flex gap-1">
                              <button
                                onClick={() => save(r.variantId, c.key)}
                                disabled={pending}
                                className="cursor-pointer border border-navy/30 px-2 py-1 text-[11px] hover:border-navy"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditing(null)}
                                className="cursor-pointer px-2 py-1 text-[11px] text-navy-300"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </td>
                      );
                    }

                    if (!cell) {
                      return (
                        <td key={c.key} className="px-5 py-3">
                          <button
                            onClick={() => {
                              setEditing({ variantId: r.variantId, channel: c.key });
                              setItemId("");
                              setModelId("");
                            }}
                            className="cursor-pointer text-[12px] text-amber-700 underline underline-offset-4"
                          >
                            Map listing
                          </button>
                        </td>
                      );
                    }

                    return (
                      <td key={c.key} className="px-5 py-3">
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">
                            {publishable(r.stockOnHand, cell.safetyBuffer)}
                            {cell.safetyBuffer > 0 && (
                              <span className="text-[11px] font-normal text-navy-300">
                                {" "}(−{cell.safetyBuffer} held)
                              </span>
                            )}
                          </span>
                          <span className="truncate text-[11px] text-navy-300" title={cell.externalItemId}>
                            {cell.externalItemId}
                            {cell.externalModelId ? `/${cell.externalModelId}` : ""}
                          </span>
                          <div className="flex items-center gap-1.5 text-[11px]">
                            <label className="flex items-center gap-1 text-navy-300">
                              buffer
                              <input
                                type="number"
                                min={0}
                                defaultValue={cell.safetyBuffer}
                                onBlur={(e) => {
                                  if (Number(e.target.value) !== cell.safetyBuffer) {
                                    setBuffer(cell.listingId, e.target.value);
                                  }
                                }}
                                className="w-12 border border-navy/20 px-1 py-0.5 text-[11px]"
                              />
                            </label>
                            <button
                              onClick={() => toggle(cell.listingId, !cell.syncEnabled)}
                              className="cursor-pointer text-navy-400 underline underline-offset-2"
                            >
                              {cell.syncEnabled ? "pause" : "resume"}
                            </button>
                            <button
                              onClick={() => remove(cell.listingId)}
                              className="cursor-pointer text-navy-400 underline underline-offset-2"
                            >
                              unmap
                            </button>
                          </div>
                          {!cell.syncEnabled && <Pill value="paused" />}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
