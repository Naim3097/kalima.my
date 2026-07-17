import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`border border-navy/10 bg-white ${className}`}>{children}</div>;
}

export function CardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-navy/10 px-5 py-4">
      <h3 className="label-caps !text-[12px] text-navy">{title}</h3>
      {action}
    </div>
  );
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
    <span className={`inline-block rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider ${PILL_STYLES[value] ?? "bg-navy-100 text-navy"}`}>
      {value}
    </span>
  );
}

export function ChannelBadge({ channel }: { channel: "web" | "shopee" | "tiktok" }) {
  const meta = {
    web: { label: "kalima.my", cls: "bg-navy text-white" },
    shopee: { label: "Shopee", cls: "bg-[#ee4d2d] text-white" },
    tiktok: { label: "TikTok", cls: "bg-[#161823] text-white" },
  }[channel];
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-navy/10">
            {head.map((h) => (
              <th key={h} className="label-caps whitespace-nowrap px-5 py-3 !text-[10px] font-medium text-navy-400">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-navy/5 text-navy">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`whitespace-nowrap px-5 py-3.5 ${className}`}>{children}</td>;
}

export function DemoNote({ children }: { children: ReactNode }) {
  return (
    <p className="mt-6 border border-dashed border-navy/20 bg-navy-100/40 px-4 py-3 text-[12px] leading-relaxed tracking-wide text-navy-400">
      {children}
    </p>
  );
}
