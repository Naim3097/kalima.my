"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { updateOrderStatus } from "@/app/admin/actions";
import type { OrderStatus } from "@/lib/admin";

/*
  Manual status controls for an order. Two transitions are deliberately absent:

  - 'paid' belongs to the payment webhook.
  - 'refunded' belongs to the Refund panel, which returns the goods to stock
    through the ledger. Offering it here as a bare status flip meant a refund
    silently left inventory understated forever.

  The action revalidates the page, so a successful update refreshes the detail
  view on its own.
*/

type Action = { label: string; status: OrderStatus; variant?: "kalima" | "kalimaOutline" };

function actionsFor(status: OrderStatus): Action[] {
  const out: Action[] = [];
  if (status === "paid") out.push({ label: "Mark fulfilled", status: "fulfilled", variant: "kalima" });
  if (status === "fulfilled") out.push({ label: "Mark completed", status: "completed", variant: "kalima" });
  if (!["completed", "cancelled", "refunded"].includes(status))
    out.push({ label: "Cancel order", status: "cancelled", variant: "kalimaOutline" });
  return out;
}

export default function StatusUpdater({
  reference,
  status,
}: {
  reference: string;
  status: OrderStatus;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const actions = actionsFor(status);

  if (actions.length === 0) {
    return (
      <p className="text-[12px] tracking-wide text-navy-400">
        No further status changes available for a {status} order.
      </p>
    );
  }

  function run(next: OrderStatus) {
    setError(null);
    startTransition(async () => {
      const res = await updateOrderStatus(reference, next);
      if ("error" in res) setError(res.error);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button
            key={a.status}
            variant={a.variant ?? "kalimaOutline"}
            size="editorial"
            disabled={pending}
            onClick={() => run(a.status)}
          >
            {a.label}
          </Button>
        ))}
      </div>
      {error && <p className="text-[12px] text-red-700">{error}</p>}
    </div>
  );
}
