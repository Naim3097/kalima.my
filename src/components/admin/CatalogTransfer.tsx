"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { importCatalogCsv, type ImportSummary } from "@/app/admin/actions";
import { Card, CardBody, CardHeader } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { CSV_COLUMNS, CSV_TEMPLATE_ROW } from "@/lib/catalog-csv";
import { toCsv } from "@/lib/csv";

/*
  Bulk catalog transfer. Export writes one row per variant; import reads that
  same shape, so the round-trip is: export -> edit in Excel/Sheets -> import.

  Import is validated as a whole before anything is written, so a bad row can't
  leave the catalog half-updated. Stock changes flow through the ledger as
  adjustments rather than overwriting the count.
*/
export function CatalogTransfer() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [headline, setHeadline] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function downloadTemplate() {
    const csv = toCsv([[...CSV_COLUMNS], [...CSV_TEMPLATE_ROW]]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "kalima-catalog-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    startTransition(async () => {
      setSummary(null);
      setHeadline(null);
      const text = await file.text();
      const res = await importCatalogCsv(text);

      if ("summary" in res && res.summary) setSummary(res.summary);
      if ("error" in res && res.error) {
        setHeadline(res.error);
        toast.error(res.error);
        return;
      }
      const s = "summary" in res ? res.summary : undefined;
      const parts = [
        s?.productsCreated ? `${s.productsCreated} products added` : "",
        s?.productsUpdated ? `${s.productsUpdated} products updated` : "",
        s?.variantsCreated ? `${s.variantsCreated} variants added` : "",
        s?.variantsUpdated ? `${s.variantsUpdated} variants updated` : "",
        s?.stockAdjusted ? `${s.stockAdjusted} stock adjustments` : "",
      ].filter(Boolean);
      const msg = parts.length ? parts.join(" · ") : "Nothing changed.";
      setHeadline(msg);
      toast.success(msg);
      router.refresh();
    });
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <Card>
      <CardHeader
        title="Bulk import / export"
        action={
          <div className="flex gap-2">
            <Button asChild variant="kalimaOutline" size="editorial">
              <a href="/admin/products/export">Export CSV</a>
            </Button>
            <Button
              type="button"
              variant="kalima"
              size="editorial"
              disabled={pending}
              onClick={() => fileInput.current?.click()}
            >
              {pending ? "Importing…" : "Import CSV"}
            </Button>
          </div>
        }
      />

      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      <CardBody>
      <p className="text-[13px] tracking-wide text-navy-400">
        One row per variant, product columns repeated. Export, edit in Excel or Google
        Sheets, then import the same file back. Matching is by <strong>slug</strong> for
        products and <strong>SKU</strong> (or colour + size) for variants — so existing
        rows update rather than duplicate.
      </p>
      <p className="mt-2 text-[12px] tracking-wide text-navy-400">
        Prices are in ringgit. Stock is applied as a ledger adjustment, so the
        movement history stays complete.{" "}
        <button type="button" onClick={downloadTemplate} className="underline hover:text-navy">
          Download a blank template
        </button>
      </p>

      {headline && (
        <p className="mt-4 text-[13px] font-medium tracking-wide text-navy">{headline}</p>
      )}

      {summary?.errors.length ? (
        <div className="mt-3 rounded border border-red-200 bg-red-50 p-3">
          <p className="text-[12px] font-medium tracking-wide text-red-900">
            {summary.errors.length} row(s) need fixing:
          </p>
          <ul className="mt-1 space-y-0.5">
            {summary.errors.map((e, i) => (
              <li key={i} className="text-[12px] tracking-wide text-red-900">
                Row {e.row}: {e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      </CardBody>
    </Card>
  );
}
