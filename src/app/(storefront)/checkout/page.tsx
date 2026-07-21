import type { Metadata } from "next";
import CheckoutForm from "@/components/checkout/CheckoutForm";

export const metadata: Metadata = {
  title: "Checkout",
  description:
    "Secure checkout — FPX, card and e-wallet payments with live EasyParcel shipping rates across Malaysia.",
};

/*
  Server Component shell. Every part of checkout reads the persisted cart or
  holds form state, so the whole flow lives in the CheckoutForm client child.
*/
export default function CheckoutPage() {
  return <CheckoutForm />;
}
