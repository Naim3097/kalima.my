import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import PasswordResetForm from "@/components/auth/PasswordResetForm";

export const metadata: Metadata = {
  title: "Set a new password",
  description: "Choose a new password for your Kalima account.",
};

/*
  Reached only via the recovery link, which the callback turns into a session.
  No session here means the link was never followed or has expired — send the
  visitor back to request a fresh one. (The proxy also gates this route.)
*/
export default async function ResetPasswordPage() {
  const current = await getCurrentUser();
  if (!current) redirect("/forgot-password");

  return (
    <div className="mx-auto max-w-md px-4 py-16 lg:py-24">
      <h1 className="text-center font-display text-3xl text-navy">Set a new password</h1>
      <p className="mt-2 text-center text-[14px] tracking-wide text-navy-400">
        Choose a new password for {current.user.email}.
      </p>

      <div className="mt-8 space-y-6">
        <PasswordResetForm mode="update" />
        <p className="text-center text-[13px] text-navy-400">
          <Link href="/account" className="text-navy underline underline-offset-4">
            Cancel
          </Link>
        </p>
      </div>
    </div>
  );
}
