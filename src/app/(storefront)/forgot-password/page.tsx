import type { Metadata } from "next";
import Link from "next/link";
import PasswordResetForm from "@/components/auth/PasswordResetForm";

export const metadata: Metadata = {
  title: "Reset password",
  description: "Reset your Kalima account password.",
};

type Props = { searchParams: Promise<{ sent?: string }> };

export default async function ForgotPasswordPage({ searchParams }: Props) {
  const { sent } = await searchParams;

  return (
    <div className="mx-auto max-w-md px-4 py-16 lg:py-24">
      <h1 className="text-center font-display text-3xl text-navy">Reset password</h1>
      <p className="mt-2 text-center text-[14px] tracking-wide text-navy-400">
        Enter your email and we&apos;ll send you a link to set a new one.
      </p>

      {sent ? (
        <div className="mt-8 space-y-4">
          <p className="border border-navy/15 bg-cream-50 px-4 py-3 text-center text-[13px] text-navy">
            If an account exists for that email, a reset link is on its way.
            Check your inbox.
          </p>
          <p className="text-center text-[13px] text-navy-400">
            <Link href="/login" className="text-navy underline underline-offset-4">
              Back to sign in
            </Link>
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-6">
          <PasswordResetForm mode="request" />
          <p className="text-center text-[13px] text-navy-400">
            Remembered it?{" "}
            <Link href="/login" className="text-navy underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
