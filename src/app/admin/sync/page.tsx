import type { Metadata } from "next";
import dynamic from "next/dynamic";
import Image from "next/image";
import { Card, CardHeader, Pill, DemoNote } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SYNC_ROWS } from "@/data/demo";

/* The activity log sits below the fold — split it out of the initial payload. */
const SyncLog = dynamic(() => import("@/components/admin/SyncLog"), {
  loading: () => <Skeleton className="h-64 w-full" />,
});

export const metadata: Metadata = {
  title: "Sync · Admin",
  description:
    "One stock pool across kalima.my, Shopee and TikTok Shop — a sale anywhere updates everywhere, no more oversell.",
};

const HEAD = ["SKU", "Product", "kalima.my", "Shopee", "TikTok Shop", "Status"];

export default function AdminSyncPage() {
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
            <Button
              variant="kalimaOutline"
              size="editorial"
              className="cursor-pointer border-navy/30 px-3 py-1.5 transition-colors"
            >
              Re-sync all
            </Button>
          }
        />
        <Table className="text-left text-[13px]">
          <TableHeader>
            <TableRow className="border-navy/10 hover:bg-transparent">
              {HEAD.map((h) => (
                <TableHead
                  key={h}
                  className="label-caps h-auto px-5 py-3 !text-[10px] font-medium text-navy-400"
                >
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-navy/5 text-navy">
            {SYNC_ROWS.map((r) => (
              <TableRow key={r.sku} className="border-b-0 hover:bg-cream-50">
                <TableCell className="px-5 py-3.5">
                  <code className="rounded bg-navy-100 px-2 py-1 text-[11px] text-navy">{r.sku}</code>
                </TableCell>
                <TableCell className="px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    {r.image && (
                      <Image
                        src={r.image}
                        alt=""
                        width={32}
                        height={40}
                        className="h-10 w-8 object-cover object-top"
                      />
                    )}
                    <span className="max-w-64 truncate">{r.product}</span>
                  </div>
                </TableCell>
                <TableCell className="px-5 py-3.5 font-medium">{r.web}</TableCell>
                <TableCell className="px-5 py-3.5">
                  {r.shopee ?? <span className="text-navy-300">—</span>}
                </TableCell>
                <TableCell className="px-5 py-3.5">
                  {r.tiktok ?? (
                    <button className="cursor-pointer text-[12px] text-amber-700 underline underline-offset-4">
                      Map listing
                    </button>
                  )}
                </TableCell>
                <TableCell className="px-5 py-3.5">
                  <Pill value={r.synced ? "synced" : "attention"} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <SyncLog />

      <DemoNote>
        Demo preview of Phase 8. Requires Shopee Open Platform + TikTok Shop Partner Center app approvals
        (1–4 weeks — applications start during Phase 3). Website Postgres is the source of truth; every movement
        goes through the stock ledger, webhook-first with a 15-minute reconciliation poll as the safety net.
      </DemoNote>
    </div>
  );
}
