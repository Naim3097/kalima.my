"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/*
  The only interactive slice of the affiliate portal — clipboard access makes
  this a client child so the surrounding page can stay a Server Component.
*/
export default function ReferralLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Referral link copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable in some contexts — demo only */
      toast.error("Couldn't copy — please copy the link manually");
    }
  };

  return (
    <div className="flex gap-2">
      <code className="flex-1 truncate border border-navy/15 bg-cream-50 px-4 py-3 text-[13px] text-navy">{link}</code>
      <Button variant="kalima" size="editorial" onClick={copy} className="cursor-pointer px-5 py-0">
        {copied ? "Copied ✓" : "Copy"}
      </Button>
    </div>
  );
}
