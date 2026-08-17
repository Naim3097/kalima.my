import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { formatRM } from "@/lib/format";
import { getOrderForCheckout } from "@/lib/commerce";
import { getPaymentProvider, listAllPaymentServices } from "@/lib/payments";
import PaymentMethodPicker from "@/components/checkout/PaymentMethodPicker";

export const metadata: Metadata = {
  title: "Choose payment",
  description: "Choose how you'd like to pay for your Kalima order.",
};

/*
  Bank/e-wallet selection (LeanX Silent Bill needs the choice before the bill is
  created). Reads the just-placed order from the cookie, lists the active
  services, and hands the choice to the startPayment action.
*/
export default async function ChoosePaymentPage() {
  const provider = getPaymentProvider();
  if (!provider) redirect("/checkout/success"); // no gateway → nothing to pick

  const jar = await cookies();
  const raw = jar.get("kalima_order")?.value;
  if (!raw) redirect("/checkout");

  let reference: string, email: string;
  try {
    ({ reference, email } = JSON.parse(raw) as { reference: string; email: string });
  } catch {
    redirect("/checkout"); // a corrupt cookie is not a crash
  }
  const order = await getOrderForCheckout(reference, email);
  if (!order) redirect("/checkout");
  if (order.status !== "pending") redirect("/checkout/success");

  /*
    Every configured gateway's options in one list, gated by the order total —
    Atome is dropped below its RM10 floor rather than offered and then rejected
    at create-payment time. See listAllPaymentServices.
  */
  const services = await listAllPaymentServices(order.total_sen);

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <h1 className="text-center font-display text-3xl text-navy">Choose payment</h1>
      <p className="mt-2 text-center text-[14px] tracking-wide text-navy-400">
        Order <span className="text-navy">{order.reference}</span> ·{" "}
        <span className="text-navy">{formatRM(order.total_sen / 100)}</span>
      </p>

      <div className="mt-8">
        <PaymentMethodPicker
          fpx={services.fpx}
          ewallet={services.ewallet}
          bnpl={services.bnpl}
          totalSen={order.total_sen}
        />
      </div>
    </div>
  );
}
