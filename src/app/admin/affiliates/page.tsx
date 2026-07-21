import type { Metadata } from "next";
import { Card, CardHeader, StatCard, Pill, DemoNote } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AFFILIATES } from "@/data/demo";
import { formatRM } from "@/lib/format";

export const metadata: Metadata = {
  title: "Affiliates · Admin",
  description:
    "Unique codes + trackable links for every ambassador. Commission accrues only on paid orders, with clawback on refunds.",
};

const HEAD = [
  "Affiliate",
  "Code",
  "Link",
  "Clicks",
  "Orders",
  "Sales",
  "Commission (10%)",
  "Status",
  "",
];

export default function AdminAffiliatesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl text-navy">Affiliates ②</h1>
          <p className="mt-1 text-[13px] tracking-wide text-navy-400">
            Unique codes + trackable links for every ambassador. Commission accrues only on paid orders, with
            clawback on refunds.
          </p>
        </div>
        <Button variant="kalima" size="editorial" className="cursor-pointer px-5 py-2.5 transition-colors">
          + Invite Affiliate
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Active affiliates" value="3" sub="1 application pending" />
        <StatCard label="Affiliate sales (30d)" value="RM109,820" sub="23% of total revenue" />
        <StatCard label="Commission owed" value="RM10,982" sub="At default 10% rate" />
        <StatCard label="Avg conversion" value="4.9%" sub="Clicks → paid orders" accent="up" />
      </div>

      <Card>
        <CardHeader
          title="Affiliate partners"
          action={
            <span className="text-[12px] text-navy-400">
              Attribution: code at checkout, or ?ref= link (30-day cookie)
            </span>
          }
        />
        <Table className="text-left text-[13px]">
          <TableHeader>
            <TableRow className="border-navy/10 hover:bg-transparent">
              {HEAD.map((h, i) => (
                <TableHead
                  key={h || `blank-${i}`}
                  className="label-caps h-auto px-5 py-3 !text-[10px] font-medium text-navy-400"
                >
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-navy/5 text-navy">
            {AFFILIATES.map((a) => (
              <TableRow key={a.code} className="border-b-0 hover:bg-cream-50">
                <TableCell className="px-5 py-3.5 font-medium">{a.name}</TableCell>
                <TableCell className="px-5 py-3.5">
                  <code className="rounded bg-navy-100 px-2 py-1 text-[12px] text-navy">{a.code}</code>
                </TableCell>
                <TableCell className="px-5 py-3.5 text-navy-400">
                  kalima.my/?ref={a.code.toLowerCase()}
                </TableCell>
                <TableCell className="px-5 py-3.5">{a.clicks.toLocaleString()}</TableCell>
                <TableCell className="px-5 py-3.5">{a.orders}</TableCell>
                <TableCell className="px-5 py-3.5">{formatRM(a.sales)}</TableCell>
                <TableCell className="px-5 py-3.5 font-medium">{formatRM(a.commission)}</TableCell>
                <TableCell className="px-5 py-3.5">
                  <Pill value={a.status} />
                </TableCell>
                <TableCell className="px-5 py-3.5">
                  {a.status === "active" ? (
                    <Button
                      variant="kalimaOutline"
                      size="editorial"
                      className="cursor-pointer border-navy/30 px-3 py-1.5 transition-colors"
                    >
                      Mark payout
                    </Button>
                  ) : (
                    <Button
                      variant="kalima"
                      size="editorial"
                      className="cursor-pointer px-3 py-1.5 transition-colors"
                    >
                      Approve
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <DemoNote>
        Demo preview of Phase 6. Affiliates get their own portal (see /affiliate on the storefront) with live stats
        and marketing assets. Fraud guards: self-purchase block, 14-day commission hold matching the return window,
        one attribution per order.
      </DemoNote>
    </div>
  );
}
