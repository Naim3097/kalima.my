"use client";

import { useState, useTransition } from "react";
import { changePassword, type AuthResult } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/*
  In-account change-password, as a disclosure so it doesn't clutter the page
  until wanted. Requires the current password (verified server-side).
*/
export default function ChangePasswordForm() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result: AuthResult = await changePassword(formData);
      if (result && "error" in result) setError(result.error);
      // On success the action redirects to /account?password=changed.
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="label-caps cursor-pointer border border-navy/30 px-4 py-2 text-navy transition-colors hover:border-navy"
      >
        Change password
      </button>
    );
  }

  return (
    <form action={onSubmit} className="max-w-sm space-y-4">
      <div className="space-y-2">
        <Label htmlFor="current_password" className="label-caps !text-[11px] text-navy-400">
          Current password
        </Label>
        <Input
          id="current_password"
          name="current_password"
          type="password"
          required
          autoComplete="current-password"
        />
      </div>
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
        <Input id="confirm" name="confirm" type="password" required autoComplete="new-password" />
      </div>

      {error && (
        <p className="border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="kalima" size="editorial" disabled={pending}>
          {pending ? "Saving…" : "Save password"}
        </Button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="label-caps cursor-pointer text-navy-400 transition-colors hover:text-navy"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
