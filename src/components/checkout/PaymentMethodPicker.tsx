"use client";

import { useState, useTransition } from "react";
import { startPayment } from "@/app/checkout/actions";
import type { PaymentService } from "@/lib/payments/types";
import { formatRM } from "@/lib/format";
import { Button } from "@/components/ui/button";

/*
  Every way to pay, in one list: FPX banks, e-wallets, and instalments.

  The selected id goes to the startPayment action, which resolves which gateway
  owns it — this component deliberately does not know or care. That is why the
  three groups render identically and only the heading differs: a shopper is
  choosing how to pay, not which of our vendors to route through.
*/
export default function PaymentMethodPicker({
  fpx,
  ewallet,
  bnpl,
  card = [],
  totalSen,
}: {
  fpx: PaymentService[];
  ewallet: PaymentService[];
  bnpl: PaymentService[];
  card?: PaymentService[];
  totalSen: number;
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

  const empty = fpx.length === 0 && ewallet.length === 0 && bnpl.length === 0 && card.length === 0;

  /*
    The instalment split, shown so the shopper sees the per-payment figure before
    committing rather than discovering it on Atome's page.

    Rounded UP to the sen: three payments of a rounded-down third can total less
    than the order, and a split that does not add up to what is owed is worse
    than one where the first payment is a sen larger. Atome computes the real
    schedule — this is an honest preview of it, which is why it says "about".
  */
  const perInstalment = Math.ceil(totalSen / 3) / 100;

  return (
    <div className="space-y-6">
      {empty ? (
        <p className="border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          No payment methods are available right now. Please try again shortly.
        </p>
      ) : (
        <>
          <Group title="Online Banking (FPX)" services={fpx} />
          <Group title="Card" services={card} />
          <Group title="E-Wallet" services={ewallet} />
          <Group title="Buy Now, Pay Later" services={bnpl} />
          {bnpl.length > 0 && (
            <p className="text-[12px] tracking-wide text-navy-400">
              About {formatRM(perInstalment)} × 3, interest free. Atome will confirm your exact
              schedule.
            </p>
          )}
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
