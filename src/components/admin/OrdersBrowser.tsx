"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { OrderStatus } from "@/lib/admin";

/*
  Filter bar for the orders list. This is a small client island — the table
  itself stays server-rendered on the page. Changing a filter rewrites the URL
  searchParams (?status=&q=), which re-runs the Server Component's listOrders().
*/

const STATUSES: { label: string; value: OrderStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Paid", value: "paid" },
  { label: "Fulfilled", value: "fulfilled" },
  { label: "Completed", value: "completed" },
  { label: "Cancelled", value: "cancelled" },
  { label: "Refunded", value: "refunded" },
];

export default function OrdersBrowser({
  status,
  q,
}: {
  status?: OrderStatus;
  q?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(q ?? "");

  function apply(next: { status?: OrderStatus | "all"; q?: string }) {
    const params = new URLSearchParams();
    const nextStatus = next.status ?? status;
    const nextQ = next.q ?? search;
    if (nextStatus && nextStatus !== "all") params.set("status", nextStatus);
    if (nextQ && nextQ.trim()) params.set("q", nextQ.trim());
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const active = status ?? "all";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2">
        {STATUSES.map((f) => (
          <button
            key={f.value}
            onClick={() => apply({ status: f.value })}
            className={`label-caps px-4 py-2 transition-colors cursor-pointer ${
              active === f.value
                ? "bg-navy text-white"
                : "border border-navy/20 text-navy-400 hover:border-navy hover:text-navy"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply({ q: search });
        }}
        className="flex items-center gap-2"
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search reference or email"
          className="w-64 border border-navy/20 bg-white px-3 py-2 text-[13px] text-navy placeholder:text-navy-300 focus:border-navy focus:outline-none"
        />
        <button
          type="submit"
          className="label-caps border border-navy/30 px-4 py-2 text-navy transition-colors hover:border-navy cursor-pointer"
        >
          Search
        </button>
      </form>
    </div>
  );
}
