import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card as ShadCard } from "@/components/ui/card";
import {
  Table as ShadTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/*
  Shared back-office primitives. Rebuilt on the shadcn primitives (Card,
  Badge, Table) with the admin mockup's flat, sharp-cornered treatment layered
  on top — the rendered output is identical to the pre-port markup.

  Everything here is server-renderable; none of it holds state.
*/

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <ShadCard
      className={cn(
        // flatten the shadcn card back to the admin surface: plain block,
        // no vertical padding, no shadow, hairline navy border on white
        "block gap-0 border border-navy/10 bg-white py-0 shadow-none",
        className,
      )}
    >
      {children}
    </ShadCard>
  );
}

export function CardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-navy/10 px-5 py-4">
      <h3 className="label-caps !text-[12px] text-navy">{title}</h3>
      {action}
    </div>
  );
}

/*
  Padded content region inside a Card.

  Card itself is deliberately padding-free: tables, lists and image grids are
  meant to bleed to the border, and giving Card padding would inset all of them.
  That leaves every text block responsible for its own inset, which is a rule
  people forget — several bodies had ended up flush against the border.

  So the inset gets a name. Reach for CardBody rather than remembering `px-5`.
  Matches CardHeader's px-5 py-4, so a header and a body line up exactly.
*/
export function CardBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}

export function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "up" | "down" }) {
  return (
    <Card className="px-5 py-4">
      <p className="label-caps text-navy-400">{label}</p>
      <p className="mt-2 font-display text-3xl text-navy">{value}</p>
      {sub && (
        <p className={`mt-1 text-[12px] tracking-wide ${accent === "up" ? "text-emerald-700" : accent === "down" ? "text-red-700" : "text-navy-400"}`}>
          {sub}
        </p>
      )}
    </Card>
  );
}

const PILL_STYLES: Record<string, string> = {
  // order statuses
  pending: "bg-amber-100 text-amber-900",
  paid: "bg-navy-100 text-navy",
  fulfilled: "bg-sky-100 text-sky-900",
  completed: "bg-emerald-100 text-emerald-900",
  refunded: "bg-red-100 text-red-900",
  packed: "bg-indigo-100 text-indigo-900",
  shipped: "bg-sky-100 text-sky-900",
  delivered: "bg-emerald-100 text-emerald-900",
  cancelled: "bg-red-100 text-red-900",
  // generic
  active: "bg-emerald-100 text-emerald-900",
  sent: "bg-emerald-100 text-emerald-900",
  scheduled: "bg-amber-100 text-amber-900",
  draft: "bg-navy-100 text-navy-400",
  synced: "bg-emerald-100 text-emerald-900",
  attention: "bg-red-100 text-red-900",
  "label ready": "bg-amber-100 text-amber-900",
  "picked up": "bg-indigo-100 text-indigo-900",
  "in transit": "bg-sky-100 text-sky-900",
};

export function Pill({ value }: { value: string }) {
  return (
    <Badge
      className={cn(
        "rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider",
        PILL_STYLES[value] ?? "bg-navy-100 text-navy",
      )}
    >
      {value}
    </Badge>
  );
}

export function ChannelBadge({ channel }: { channel: "web" | "shopee" | "tiktok" }) {
  const meta = {
    web: { label: "kalima.my", cls: "bg-navy text-white" },
    shopee: { label: "Shopee", cls: "bg-[#ee4d2d] text-white" },
    tiktok: { label: "TikTok", cls: "bg-[#161823] text-white" },
  }[channel];
  return (
    <Badge className={cn("rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider", meta.cls)}>
      {meta.label}
    </Badge>
  );
}

/** Neutral chip used for customer tags / tiers. */
export function Chip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <Badge className={cn("rounded bg-navy-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-navy", className)}>
      {children}
    </Badge>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <ShadTable className="w-full text-left text-[13px]">
      <TableHeader>
        <TableRow className="border-navy/10 hover:bg-transparent">
          {head.map((h) => (
            <TableHead
              key={h}
              className="label-caps h-auto whitespace-nowrap px-5 py-3 !text-[10px] font-medium text-navy-400"
            >
              {h}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody className="text-navy">{children}</TableBody>
    </ShadTable>
  );
}

/** Body row — hairline separator + the mockup's cream hover. */
export function Tr({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <TableRow className={cn("border-navy/5 hover:bg-cream-50", className)}>{children}</TableRow>;
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <TableCell className={cn("whitespace-nowrap px-5 py-3.5", className)}>{children}</TableCell>;
}
