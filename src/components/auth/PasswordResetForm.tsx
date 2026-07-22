"use client";

import { useState, useTransition } from "react";
import { requestPasswordReset, updatePassword, type AuthResult } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/*
  Both steps of password reset share this form:
    "request" — enter email, receive a recovery link
    "update"  — set a new password (inside the recovery session)
  Mirrors AuthForm's pending/error handling.
*/
export default function PasswordResetForm({ mode }: { mode: "request" | "update" }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isRequest = mode === "request";

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result: AuthResult = isRequest
        ? await requestPasswordReset(formData)
        : await updatePassword(formData);
      if (result && "error" in result) setError(result.error);
    });
  }

  return (
    <form action={onSubmit} className="space-y-5">
      {isRequest ? (
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
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="password" className="label-caps !text-[11px] text-navy-400">
              New password
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="new-password"
              placeholder="At least 8 characters"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm" className="label-caps !text-[11px] text-navy-400">
              Confirm new password
            </Label>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              required
              autoComplete="new-password"
              placeholder="Re-enter your new password"
            />
          </div>
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
        {pending ? "Please wait…" : isRequest ? "Send reset link" : "Set new password"}
      </Button>
    </form>
  );
}
