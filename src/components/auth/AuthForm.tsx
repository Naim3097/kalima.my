"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { signIn, signUp, type AuthResult } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

type Mode = "login" | "signup";

/*
  Shared auth form. One client component drives both /login and /signup so the
  brand styling and pending/error handling live in one place. Submits to the
  server actions in src/app/auth/actions.ts.
*/
export default function AuthForm({ mode, next }: { mode: Mode; next?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isSignup = mode === "signup";

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result: AuthResult = isSignup
        ? await signUp(formData)
        : await signIn(formData);
      // A returned object means failure; success redirects and never returns.
      if (result && "error" in result) setError(result.error);
    });
  }

  return (
    <form action={onSubmit} className="space-y-5">
      {next && <input type="hidden" name="next" value={next} />}

      {isSignup && (
        <div className="space-y-2">
          <Label htmlFor="full_name" className="label-caps !text-[11px] text-navy-400">
            Full name
          </Label>
          <Input id="full_name" name="full_name" autoComplete="name" placeholder="Nurul Aisyah" />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="email" className="label-caps !text-[11px] text-navy-400">
          Email
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="password" className="label-caps !text-[11px] text-navy-400">
            Password
          </Label>
          {!isSignup && (
            <Link
              href="/forgot-password"
              className="text-[12px] text-navy-400 underline underline-offset-4 hover:text-navy"
            >
              Forgot?
            </Link>
          )}
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoComplete={isSignup ? "new-password" : "current-password"}
          placeholder={isSignup ? "At least 8 characters" : "••••••••"}
        />
      </div>

      {isSignup && (
        <>
          <div className="space-y-2">
            <Label htmlFor="phone" className="label-caps !text-[11px] text-navy-400">
              Phone <span className="normal-case tracking-normal text-navy-300">(optional)</span>
            </Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              placeholder="+60 12 345 6789"
            />
          </div>

          <label className="flex items-start gap-3 pt-1">
            <Checkbox id="marketing_consent" name="marketing_consent" className="mt-0.5" />
            <span className="text-[13px] leading-relaxed text-navy-400">
              Keep me updated on new collections, private sales and Kalima Club rewards.
              You can unsubscribe anytime.
            </span>
          </label>
        </>
      )}

      {error && (
        <p className="border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </p>
      )}

      <Button
        type="submit"
        variant="kalima"
        size="editorial"
        className="w-full"
        disabled={pending}
      >
        {pending ? "Please wait…" : isSignup ? "Create account" : "Sign in"}
      </Button>

      <p className="text-center text-[13px] text-navy-400">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-navy underline underline-offset-4">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to Kalima?{" "}
            <Link href="/signup" className="text-navy underline underline-offset-4">
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
