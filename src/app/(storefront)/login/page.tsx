import type { Metadata } from "next";
import AuthForm from "@/components/auth/AuthForm";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Kalima account.",
};

type Props = {
  searchParams: Promise<{ next?: string; confirm?: string; error?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const { next, confirm, error } = await searchParams;

  return (
    <div className="mx-auto max-w-md px-4 py-16 lg:py-24">
      <h1 className="text-center font-display text-3xl text-navy">Welcome back</h1>
      <p className="mt-2 text-center text-[14px] tracking-wide text-navy-400">
        Sign in to your Kalima account.
      </p>

      {confirm && (
        <p className="mt-8 border border-navy/15 bg-cream-50 px-4 py-3 text-center text-[13px] text-navy">
          Check your inbox to confirm your email, then sign in.
        </p>
      )}
      {error === "confirm" && (
        <p className="mt-8 border border-red-200 bg-red-50 px-4 py-3 text-center text-[13px] text-red-700">
          That confirmation link was invalid or expired. Try signing in.
        </p>
      )}

      <div className="mt-8">
        <AuthForm mode="login" next={next} />
      </div>
    </div>
  );
}
