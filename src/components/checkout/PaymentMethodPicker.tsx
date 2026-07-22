"use client";

import { useState, useTransition } from "react";
import { startPayment } from "@/app/checkout/actions";
import type { PaymentService } from "@/lib/payments";
import { Button } from "@/components/ui/button";

/*
  FPX bank / e-wallet chooser. The selected payment_service_id goes to the
  startPayment action, which creates the LeanX bill and redirects to the hosted
  payment page.
*/
export default function PaymentMethodPicker({
  fpx,
  ewallet,
}: {
  fpx: PaymentService[];
  ewallet: PaymentService[];
}) {
  const [selected, setSelected] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function pay() {
    if (!selected) {
      setError("Please choose how you'd like to pay.");
      return;
    }
    setError(null);
    start(async () => {
      const result = await startPayment(selected);
      // Success redirects to the gateway; only a failure returns here.
      if (result && "error" in result) setError(result.error);
    });
  }

  const Group = ({ title, services }: { title: string; services: PaymentService[] }) =>
    services.length ? (
      <div className="space-y-2">
        <p className="label-caps !text-[11px] text-navy-400">{title}</p>
        {services.map((s) => (
          <label
            key={s.id}
            className={`flex cursor-pointer items-center gap-3 border px-4 py-3.5 text-[14px] transition-colors ${
              selected === s.id ? "border-navy bg-navy-100/40" : "border-navy/15 hover:border-navy/40"
            }`}
          >
            <input
              type="radio"
              name="pay-method"
              checked={selected === s.id}
              onChange={() => setSelected(s.id)}
              className="accent-navy"
            />
            <span className="text-navy">{s.name}</span>
          </label>
        ))}
      </div>
    ) : null;

  const empty = fpx.length === 0 && ewallet.length === 0;

  return (
    <div className="space-y-6">
      {empty ? (
        <p className="border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          No payment methods are available right now. Please try again shortly.
        </p>
      ) : (
        <>
          <Group title="Online Banking (FPX)" services={fpx} />
          <Group title="E-Wallet" services={ewallet} />
        </>
      )}

      {error && (
        <p className="border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</p>
      )}

      <Button
        variant="kalima"
        size="editorial"
        className="w-full"
        onClick={pay}
        disabled={pending || empty}
      >
        {pending ? "Redirecting to payment…" : "Pay now"}
      </Button>
      <p className="text-center text-[11px] tracking-wide text-navy-300">
        You&apos;ll complete payment securely on our gateway&apos;s page.
      </p>
    </div>
  );
}
