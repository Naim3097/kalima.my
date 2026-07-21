import type { Metadata } from "next";
import { Card, CardHeader, StatCard, Pill, DemoNote } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import CampaignComposer from "@/components/admin/CampaignComposer";
import { CAMPAIGNS } from "@/data/demo";

export const metadata: Metadata = {
  title: "Campaigns · Admin",
  description:
    "Message customers directly — one-to-one or bulk WhatsApp & email campaigns to segmented audiences.",
};

const HEAD = ["Campaign", "Channel", "Audience", "Recipients", "Delivered", "Read", "Status", "Date"];

export default function AdminCampaignsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl text-navy">Broadcasts ①</h1>
          <p className="mt-1 text-[13px] tracking-wide text-navy-400">
            Message customers directly — one-to-one or bulk WhatsApp & email campaigns to segmented audiences.
          </p>
        </div>
        <Button variant="kalima" size="editorial" className="cursor-pointer px-5 py-2.5 transition-colors">
          + New Broadcast
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Messages sent (30d)" value="9,146" sub="WhatsApp 4,038 · Email 5,108" />
        <StatCard label="Read rate — WhatsApp" value="79%" sub="▲ industry avg ~65%" accent="up" />
        <StatCard label="Revenue from broadcasts (30d)" value="RM18,420" sub="Attributed within 7 days of click" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Campaigns" />
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
              {CAMPAIGNS.map((c) => (
                <TableRow key={c.name} className="border-b-0 hover:bg-cream-50">
                  <TableCell className="px-5 py-3.5 font-medium">{c.name}</TableCell>
                  <TableCell className="px-5 py-3.5">
                    <Badge
                      variant="ghost"
                      className={`rounded border-0 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                        c.channel === "WhatsApp" ? "bg-[#25d366]/15 text-[#128c4a]" : "bg-navy-100 text-navy"
                      }`}
                    >
                      {c.channel}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-48 truncate px-5 py-3.5 text-navy-400">{c.segment}</TableCell>
                  <TableCell className="px-5 py-3.5">{c.recipients.toLocaleString()}</TableCell>
                  <TableCell className="px-5 py-3.5">
                    {c.delivered ? c.delivered.toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="px-5 py-3.5">
                    {c.read ? `${Math.round((c.read / c.recipients) * 100)}%` : "—"}
                  </TableCell>
                  <TableCell className="px-5 py-3.5">
                    <Pill value={c.status} />
                  </TableCell>
                  <TableCell className="px-5 py-3.5 text-navy-400">{c.date}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        {/* Composer preview */}
        <CampaignComposer />
      </div>

      <DemoNote>
        Demo preview of Phase 5. Live sending uses the WhatsApp Business Cloud API (requires Meta Business
        verification + template approval — client action items) and Resend for email. Delivery/read receipts stream
        back into these reports per message. Meta bills ~RM0.30–0.60 per marketing conversation.
      </DemoNote>
    </div>
  );
}
