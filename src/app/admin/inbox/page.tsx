import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { DemoNote } from "@/components/admin/ui";
import { Skeleton } from "@/components/ui/skeleton";

/* Heaviest admin screen — the 3-pane inbox is split out of the initial payload. */
const InboxPanes = dynamic(() => import("@/components/admin/InboxPanes"), {
  loading: () => (
    <>
      <Skeleton className="h-10 w-full max-w-md" />
      <Skeleton className="h-[480px] w-full" />
    </>
  ),
});

export const metadata: Metadata = {
  title: "Inbox · Admin",
  description:
    "Shopee chat, TikTok Shop chat, Instagram DM and WhatsApp — read and replied from one place, linked to orders.",
};

export default function AdminInboxPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-navy">Unified Inbox ⑥</h1>
        <p className="mt-1 text-[13px] tracking-wide text-navy-400">
          Shopee chat, TikTok Shop chat, Instagram DM and WhatsApp — read and replied from one place, linked to
          orders.
        </p>
      </div>

      <InboxPanes />

      <DemoNote>
        Demo preview of Phase 9. Scope: Shopee chat + TikTok Shop buyer chat + Instagram DM (after Meta App Review)
        + WhatsApp. Heads-up — TikTok <em>personal/creator</em> DMs have no public API on any platform, so those
        stay in the TikTok app. Replies respect each platform&apos;s messaging windows (e.g. IG/WhatsApp 24-hour rule).
      </DemoNote>
    </div>
  );
}
