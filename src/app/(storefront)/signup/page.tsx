import type { Metadata } from "next";
import AuthForm from "@/components/auth/AuthForm";

export const metadata: Metadata = {
  title: "Create account",
  description: "Join Kalima — save your wishlist, track orders and earn Kalima Club points.",
};

type Props = { searchParams: Promise<{ next?: string }> };

export default async function SignupPage({ searchParams }: Props) {
  const { next } = await searchParams;

  return (
    <div className="mx-auto max-w-md px-4 py-16 lg:py-24">
      <h1 className="text-center font-display text-3xl text-navy">Join Kalima</h1>
      <p className="mt-2 text-center text-[14px] tracking-wide text-navy-400">
        Save your wishlist, track orders and earn Kalima Club points.
      </p>

      <div className="mt-8">
        <AuthForm mode="signup" next={next} />
      </div>
    </div>
  );
}
