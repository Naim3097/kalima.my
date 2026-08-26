import type { Metadata } from "next";
import { CampaignManager } from "@/components/admin/CampaignManager";
import { getSubscriberStats, listCampaigns } from "@/lib/admin";
import {
  listSendableTemplates,
  templatesBlockedReason,
  type WhatsAppTemplate,
} from "@/lib/channels/whatsapp-templates";
import { countWhatsAppAudience } from "@/lib/messaging/audience";

export const metadata: Metadata = {
  title: "Broadcasts · Admin",
  description: "Segmented email campaigns to consenting customers.",
};

/*
  Replaces the Phase 3 demo mock-up with the working email pipeline — and, since
  Meta Business verification cleared on 5 August 2026, the WhatsApp one beside
  it.

  The two channels share this screen but not their composers, because a WhatsApp
  broadcast is not an email with a phone number attached: the wording belongs to
  an approved template held at Meta, the audience is resolved by phone against a
  different consent record, and the opt-out arrives as a reply rather than a
  clicked link. What they do share is the segment filters and the send/report
  loop, which is why one screen is still the right shape.

  TEMPLATE READS FAIL SOFT, exactly as on /admin/inbox: an email campaign must
  remain composable and sendable on a day when Meta's registry is unreachable,
  so the WhatsApp half degrades to a stated reason instead of a 500.
*/
async function loadWhatsApp(): Promise<{
  templates: WhatsAppTemplate[];
  audienceSize: number | null;
  blocked: string | null;
}> {
  const blocked = templatesBlockedReason();
  if (blocked) return { templates: [], audienceSize: null, blocked };
  try {
    const [templates, audienceSize] = await Promise.all([
      listSendableTemplates(),
      /* The unfiltered audience — everyone who could ever receive a broadcast.
         Shown as context the way the subscriber count is for email, so staff
         can see the reach before building a segment. */
      countWhatsAppAudience({}),
    ]);
    return { templates, audienceSize, blocked: null };
  } catch (e) {
    return {
      templates: [],
      audienceSize: null,
      blocked: `WhatsApp broadcasts are unavailable: ${
        e instanceof Error ? e.message : "unknown error"
      }`,
    };
  }
}

export default async function AdminCampaignsPage() {
  const [campaigns, subscriberStats, whatsapp] = await Promise.all([
    listCampaigns(),
    getSubscriberStats(),
    loadWhatsApp(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-navy">Broadcasts</h1>
        <p className="mt-1 text-[13px] tracking-wide text-navy-400">
          Segmented email and WhatsApp to customers who opted in. Email carries an
          unsubscribe link; WhatsApp honours a “STOP” reply. Opted-out customers are
          never included, on either channel.
        </p>
      </div>

      <CampaignManager
        campaigns={campaigns}
        subscriberStats={subscriberStats}
        templates={whatsapp.templates}
        whatsappAudienceSize={whatsapp.audienceSize}
        whatsappBlocked={whatsapp.blocked}
      />
    </div>
  );
}
