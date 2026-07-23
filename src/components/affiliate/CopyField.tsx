"use client";

import { useState } from "react";
import { toast } from "sonner";

/*
  A read-only value with a copy button — the affiliate's link and code are
  things they paste elsewhere, so copying is the primary interaction.
*/
export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label} copied`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the text and copy manually.");
    }
  }

  return (
    <div>
      <p className="label-caps text-[10px] text-navy-400">{label}</p>
      <div className="mt-1 flex items-stretch border border-navy/15 bg-white">
        <code className="flex-1 overflow-x-auto whitespace-nowrap px-3 py-2.5 text-[13px] text-navy">
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 border-l border-navy/15 px-4 text-[11px] uppercase tracking-wider text-navy-400 transition-colors hover:bg-cream hover:text-navy"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
