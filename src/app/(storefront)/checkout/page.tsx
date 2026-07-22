import type { Metadata } from "next";
import CheckoutForm from "@/components/checkout/CheckoutForm";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Checkout",
  description:
    "Secure checkout with delivery across Malaysia. Free shipping over RM300.",
};

/*
  Server Component shell. Prefills contact details for a signed-in shopper, then
  hands off to the CheckoutForm client child (cart + form state + the order
  server action).
*/
export default async function CheckoutPage() {
  const current = await getCurrentUser();
  return (
    <CheckoutForm
      defaultEmail={current?.user.email ?? ""}
      defaultName={current?.profile?.full_name ?? ""}
      defaultPhone={current?.profile?.phone ?? ""}
    />
  );
}
