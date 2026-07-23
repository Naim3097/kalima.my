"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { applyAsAffiliate } from "@/app/(storefront)/affiliate/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function AffiliateApply({ defaultName }: { defaultName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(defaultName);
  const [slug, setSlug] = useState(slugify(defaultName));
  const [touched, setTouched] = useState(false);

  function submit() {
    startTransition(async () => {
      const res = await applyAsAffiliate({ name, slug });
      if ("error" in res) toast.error(res.error);
      else {
        toast.success("Application received — we'll review it shortly.");
        router.refresh();
      }
    });
  }

  return (
    <div className="mx-auto max-w-lg border border-navy/10 bg-white p-8">
      <h2 className="font-display text-2xl text-navy">Become a Kalima affiliate</h2>
      <p className="mt-3 text-[14px] leading-relaxed tracking-wide text-navy-400">
        Share Kalima with your audience and earn commission on every sale that comes
        through your link. Applications are reviewed by our team.
      </p>

      <div className="mt-6 space-y-4">
        <div>
          <Label htmlFor="aff-name">Your name</Label>
          <Input
            id="aff-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!touched) setSlug(slugify(e.target.value));
            }}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="aff-slug">Referral link name</Label>
          <Input
            id="aff-slug"
            value={slug}
            onChange={(e) => { setTouched(true); setSlug(slugify(e.target.value)); }}
            className="mt-1"
          />
          <p className="mt-1 text-[12px] tracking-wide text-navy-400">
            Your link will be kalima.my/?ref=<strong>{slug || "your-name"}</strong>
          </p>
        </div>
        <Button
          type="button"
          variant="kalima"
          size="editorial"
          disabled={pending}
          onClick={submit}
          className="w-full"
        >
          {pending ? "Sending…" : "Apply to join"}
        </Button>
      </div>
    </div>
  );
}
