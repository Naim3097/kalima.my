import { Card, CardHeader, StatCard, Table, Td, Pill, DemoNote } from "../../components/admin/ui";
import { CAMPAIGNS } from "../../data/demo";

export default function AdminCampaigns() {
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl text-navy">Broadcasts ①</h1>
          <p className="mt-1 text-[13px] tracking-wide text-navy-400">
            Message customers directly — one-to-one or bulk WhatsApp & email campaigns to segmented audiences.
          </p>
        </div>
        <button className="label-caps bg-navy px-5 py-2.5 text-white hover:bg-navy-700 transition-colors cursor-pointer">
          + New Broadcast
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Messages sent (30d)" value="9,146" sub="WhatsApp 4,038 · Email 5,108" />
        <StatCard label="Read rate — WhatsApp" value="79%" sub="▲ industry avg ~65%" accent="up" />
        <StatCard label="Revenue from broadcasts (30d)" value="RM18,420" sub="Attributed within 7 days of click" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Campaigns" />
          <Table head={["Campaign", "Channel", "Audience", "Recipients", "Delivered", "Read", "Status", "Date"]}>
            {CAMPAIGNS.map((c) => (
              <tr key={c.name} className="hover:bg-cream-50">
                <Td className="font-medium">{c.name}</Td>
                <Td>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                      c.channel === "WhatsApp" ? "bg-[#25d366]/15 text-[#128c4a]" : "bg-navy-100 text-navy"
                    }`}
                  >
                    {c.channel}
                  </span>
                </Td>
                <Td className="max-w-48 truncate text-navy-400">{c.segment}</Td>
                <Td>{c.recipients.toLocaleString()}</Td>
                <Td>{c.delivered ? c.delivered.toLocaleString() : "—"}</Td>
                <Td>{c.read ? `${Math.round((c.read / c.recipients) * 100)}%` : "—"}</Td>
                <Td>
                  <Pill value={c.status} />
                </Td>
                <Td className="text-navy-400">{c.date}</Td>
              </tr>
            ))}
          </Table>
        </Card>

        {/* Composer preview */}
        <Card>
          <CardHeader title="Composer — WhatsApp template" />
          <div className="space-y-4 px-5 py-5">
            <div>
              <p className="label-caps mb-2 text-navy-400">Audience</p>
              <div className="border border-navy/20 bg-cream-50 px-3 py-2.5 text-[13px] text-navy">
                Tier: Gold + Platinum · consented · <span className="text-navy-400">est. reach 697</span>
              </div>
            </div>
            <div>
              <p className="label-caps mb-2 text-navy-400">Template (Meta-approved)</p>
              <div className="rounded-lg rounded-tl-none bg-[#e7f8f0] px-4 py-3 text-[13px] leading-relaxed text-[#0b3d2c] shadow-sm">
                Hi <strong>{"{{name}}"}</strong> 🤍 The <strong>Raya Private Sale</strong> is now open for Kalima
                Club {"{{tier}}"} members — 48 hours early, with your <strong>{"{{voucher}}"}</strong> voucher
                inside. Shop before it opens to everyone: kalima.my/raya
                <p className="mt-2 text-[11px] text-[#0b3d2c]/60">Reply STOP to unsubscribe</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="label-caps flex-1 bg-navy px-4 py-2.5 text-white hover:bg-navy-700 transition-colors cursor-pointer">
                Send now
              </button>
              <button className="label-caps flex-1 border border-navy/30 px-4 py-2.5 text-navy hover:border-navy transition-colors cursor-pointer">
                Schedule
              </button>
            </div>
          </div>
        </Card>
      </div>

      <DemoNote>
        Demo preview of Phase 5. Live sending uses the WhatsApp Business Cloud API (requires Meta Business
        verification + template approval — client action items) and Resend for email. Delivery/read receipts stream
        back into these reports per message. Meta bills ~RM0.30–0.60 per marketing conversation.
      </DemoNote>
    </div>
  );
}
