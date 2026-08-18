"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveSignupPromo } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AdminSignupPromo } from "@/lib/admin";

/*
  The sign-up popup, edited.

  One form with one Save, unlike the footer's lists: this is a single offer, and
  a half-saved offer — new heading, old amount — is a promise the shop cannot
  keep.

  TWO SWITCHES that read as one thing and are not: `enabled` decides whether the
  POPUP appears, the amount decides what a first-time member is actually given.
  Turning the popup off does not stop the discount, and the copy above the
  fields says so, because assuming otherwise costs real money.

  Perks are edited as LINES in a textarea rather than a repeater of inputs. Four
  short phrases do not need add/remove/reorder controls, and a textarea is the
  one editor everybody already knows how to use.
*/
export function SignupPromoEditor({ promo }: { promo: AdminSignupPromo }) {
  const [pending, startTransition] = useTransition();

  const [enabled, setEnabled] = useState(promo.enabled);
  const [eyebrow, setEyebrow] = useState(promo.eyebrow);
  const [heading, setHeading] = useState(promo.heading);
  const [body, setBody] = useState(promo.body);
  const [perksText, setPerksText] = useState(promo.perks.join("\n"));
  const [firstOrderRm, setFirstOrderRm] = useState(
    promo.firstOrderDiscountRm ? promo.firstOrderDiscountRm.toFixed(2) : "",
  );
  const [ctaLabel, setCtaLabel] = useState(promo.ctaLabel);
  const [ctaHref, setCtaHref] = useState(promo.ctaHref);
  const [delaySeconds, setDelaySeconds] = useState(String(promo.delaySeconds));
  const [dismissDays, setDismissDays] = useState(String(promo.dismissDays));

  function save() {
    startTransition(async () => {
      const res = await saveSignupPromo({
        enabled,
        eyebrow,
        heading,
        body,
        perks: perksText.split("\n").map((l) => l.trim()).filter(Boolean),
        firstOrderDiscountSen: Math.round(Number(firstOrderRm || 0) * 100),
        ctaLabel,
        ctaHref,
        delaySeconds: Number(delaySeconds),
        dismissDays: Number(dismissDays),
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(enabled ? "Popup is live." : "Popup saved and switched off.");
    });
  }

  return (
    <div className="px-5 py-5">
      <p className="mb-4 text-[13px] tracking-wide text-navy-400">
        The popup is shown to visitors who are not signed in, once, after a short delay — members
        never see it. The discount below is separate: it applies at checkout whether or not the
        popup is up.
      </p>

      <label className="flex cursor-pointer items-center gap-2 text-[13px] text-navy">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="size-4 accent-navy"
        />
        Show this popup on the storefront
      </label>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="promo-eyebrow" className="label-caps text-navy-400">Eyebrow</Label>
          <Input id="promo-eyebrow" value={eyebrow} onChange={(e) => setEyebrow(e.target.value)} placeholder="Kalima Club" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="promo-heading" className="label-caps text-navy-400">Heading</Label>
          <Input id="promo-heading" value={heading} onChange={(e) => setHeading(e.target.value)} placeholder="RM10 off your first order" />
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <Label htmlFor="promo-body" className="label-caps text-navy-400">Body</Label>
        <Textarea id="promo-body" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Join Kalima Club — it takes a minute…" />
      </div>

      <div className="mt-4 space-y-2">
        <Label htmlFor="promo-perks" className="label-caps text-navy-400">Benefits — one per line</Label>
        <Textarea
          id="promo-perks"
          rows={4}
          value={perksText}
          onChange={(e) => setPerksText(e.target.value)}
          placeholder={"RM10 off your first order\n1 point for every RM1 you spend"}
        />
      </div>

      <div className="mt-4 space-y-2">
        <Label htmlFor="promo-amount" className="label-caps text-navy-400">
          First-order discount (RM)
        </Label>
        <Input
          id="promo-amount"
          type="number"
          min={0}
          step="0.01"
          value={firstOrderRm}
          onChange={(e) => setFirstOrderRm(e.target.value)}
          placeholder="No discount"
        />
        {/*
          There is no code to hand out and none to type. Saying the rule back in
          plain words is the only way an editor can tell what this number does —
          and "who does NOT get it" is the half people assume wrong.
        */}
        <p className="text-[13px] tracking-wide text-navy">
          {Number(firstOrderRm) > 0
            ? `Members get RM${Number(firstOrderRm).toFixed(2)} off automatically at checkout — but only on their first purchase.`
            : "No discount — the popup can still invite people to join."}
        </p>
        <p className="text-[12px] tracking-wide text-navy-400">
          Applied without a code, so it cannot be shared. Anyone who has already bought, and
          anyone checking out as a guest, is not eligible. It does not stack with a discount code.
        </p>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="promo-cta" className="label-caps text-navy-400">Button label</Label>
          <Input id="promo-cta" value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} placeholder="Create my account" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="promo-href" className="label-caps text-navy-400">Button links to</Label>
          <Input id="promo-href" value={ctaHref} onChange={(e) => setCtaHref(e.target.value)} placeholder="/signup" />
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="promo-delay" className="label-caps text-navy-400">Appears after (seconds)</Label>
          <Input id="promo-delay" type="number" min={0} max={120} step={1} value={delaySeconds} onChange={(e) => setDelaySeconds(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="promo-dismiss" className="label-caps text-navy-400">Stays closed for (days)</Label>
          <Input id="promo-dismiss" type="number" min={1} max={365} step={1} value={dismissDays} onChange={(e) => setDismissDays(e.target.value)} />
        </div>
      </div>
      <p className="mt-2 text-[12px] tracking-wide text-navy-400">
        Once someone closes it, it stays closed on that device for this many days.
      </p>

      <div className="mt-5">
        <Button variant="kalima" size="sm" className="cursor-pointer" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save popup"}
        </Button>
      </div>
    </div>
  );
}
