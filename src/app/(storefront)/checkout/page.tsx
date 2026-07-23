import type { Metadata } from "next";
import CheckoutForm from "@/components/checkout/CheckoutForm";
import { getCurrentUser } from "@/lib/auth";
import { getMyClub } from "@/lib/loyalty";

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

  /*
    Club standing is resolved on the SERVER and passed down for display only.
    The form sends a points *request*; create_order clamps it against the real
    balance, so a tampered client can misdraw this panel but never the price.
  */
  const club = current ? await getMyClub() : null;

  return (
    <CheckoutForm
      defaultEmail={current?.user.email ?? ""}
      defaultName={current?.profile?.full_name ?? ""}
      defaultPhone={current?.profile?.phone ?? ""}
      loyalty={
        club && club.rules.enabled && club.balance > 0
          ? {
              balance: club.balance,
              senPerPoint: club.rules.senPerPoint,
              minRedeemPoints: club.rules.minRedeemPoints,
              maxRedeemBps: club.rules.maxRedeemBps,
              pointsPerRm: club.rules.pointsPerRm,
              multiplierBps: club.tier.multiplierBps,
              tierName: club.tier.name,
            }
          : null
      }
    />
  );
}
