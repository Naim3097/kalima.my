import type { Metadata } from "next";
import { CampaignManager } from "@/components/admin/CampaignManager";
import { getSubscriberStats, listCampaigns } from "@/lib/admin";

export const metadata: Metadata = {
  title: "Broadcasts · Admin",
  description: "Segmented email campaigns to consenting customers.",
};

/*
  Replaces the Phase 3 demo mock-up with the working email pipeline.

  WhatsApp is the other half of this phase and is blocked on the client's Meta
  Business verification plus per-template approval — a multi-week external
  dependency. The campaign and recipient tables are already channel-agnostic, so
  it slots in without reshaping anything here.
*/
export default async function AdminCampaignsPage() {
  const [campaigns, subscriberStats] = await Promise.all([
    listCampaigns(),
    getSubscriberStats(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-navy">Broadcasts</h1>
        <p className="mt-1 text-[13px] tracking-wide text-navy-400">
          Segmented email to customers who opted in. Every message carries an
          unsubscribe link, and opted-out addresses are never included.
        </p>
      </div>

      <CampaignManager campaigns={campaigns} subscriberStats={subscriberStats} />
    </div>
  );
}
