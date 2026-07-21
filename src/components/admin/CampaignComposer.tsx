"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardHeader } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";

/*
  Broadcast composer — the WhatsApp template preview updates live from the
  draft below. Sending is stubbed for the demo (Phase 5 wires the WhatsApp
  Business Cloud API).
*/
type Draft = {
  audience: string;
  reach: number;
  campaign: string;
  tokens: { name: string; tier: string; voucher: string };
};

const INITIAL: Draft = {
  audience: "Tier: Gold + Platinum · consented",
  reach: 697,
  campaign: "Raya Private Sale",
  tokens: { name: "{{name}}", tier: "{{tier}}", voucher: "{{voucher}}" },
};

export default function CampaignComposer() {
  const [draft] = useState<Draft>(INITIAL);

  return (
    <Card>
      <CardHeader title="Composer — WhatsApp template" />
      <div className="space-y-4 px-5 py-5">
        <div>
          <p className="label-caps mb-2 text-navy-400">Audience</p>
          <div className="border border-navy/20 bg-cream-50 px-3 py-2.5 text-[13px] text-navy">
            {draft.audience} · <span className="text-navy-400">est. reach {draft.reach}</span>
          </div>
        </div>
        <div>
          <p className="label-caps mb-2 text-navy-400">Template (Meta-approved)</p>
          <div className="rounded-lg rounded-tl-none bg-[#e7f8f0] px-4 py-3 text-[13px] leading-relaxed text-[#0b3d2c] shadow-sm">
            Hi <strong>{draft.tokens.name}</strong> 🤍 The <strong>{draft.campaign}</strong> is now open for Kalima
            Club {draft.tokens.tier} members — 48 hours early, with your <strong>{draft.tokens.voucher}</strong> voucher
            inside. Shop before it opens to everyone: kalima.my/raya
            <p className="mt-2 text-[11px] text-[#0b3d2c]/60">Reply STOP to unsubscribe</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="kalima"
            size="editorial"
            className="flex-1 cursor-pointer px-4 py-2.5 transition-colors"
            onClick={() => toast.success(`Broadcast queued to ${draft.reach} recipients (demo)`)}
          >
            Send now
          </Button>
          <Button
            variant="kalimaOutline"
            size="editorial"
            className="flex-1 cursor-pointer border-navy/30 px-4 py-2.5 transition-colors"
            onClick={() => toast("Scheduling opens with Phase 5 (demo)")}
          >
            Schedule
          </Button>
        </div>
      </div>
    </Card>
  );
}
