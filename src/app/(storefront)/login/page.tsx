import type { Metadata } from "next";
import AuthForm from "@/components/auth/AuthForm";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Kalima account.",
};

type Props = {
  searchParams: Promise<{ next?: string; confirm?: string; error?: string }>;
};

/*
  Email-link failures, named separately.

  These used to collapse into one "invalid or expired" for every cause —
  no token, wrong type, expired, already used, auth misconfigured. That is
  indistinguishable from a bug for the person reading it, and it cost real
  debugging time. Each case now says what actually happened and what to do.
*/
const LINK_ERRORS: Record<string, string> = {
  link_expired: "That link has expired. Request a new one — they are valid for a limited time.",
  link_used: "That link has already been used. Request a new one.",
  link_invalid: "That link could not be verified. Request a new one.",
  link_incomplete: "That link is missing information. Copy the full URL from the email, or request a new one.",
  link_unsupported: "That link type is not supported.",
  auth_unconfigured: "Sign-in is not configured on this deployment.",
  // Kept: /auth/callback (OAuth) still emits this.
  confirm: "That confirmation link was invalid or expired. Try signing in.",
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
      {error && LINK_ERRORS[error] && (
        <p className="mt-8 border border-red-200 bg-red-50 px-4 py-3 text-center text-[13px] text-red-700">
          {LINK_ERRORS[error]}
        </p>
      )}

      <div className="mt-8">
        <AuthForm mode="login" next={next} />
      </div>
    </div>
  );
}
