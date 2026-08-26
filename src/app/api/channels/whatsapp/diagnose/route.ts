import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { GRAPH, whatsappPhoneId, whatsappToken } from "@/lib/channels/meta";

/*
  What the WhatsApp credentials in this environment actually are, as Meta
  sees them — without revealing the token.

  Exists because the values are marked sensitive in Vercel and cannot be read
  back, so when "Sync templates" fails the only way to tell a wrong id from a
  token missing a scope is to ask Graph directly from inside the deployment.
  Reports: the token's type and scopes (debug_token), the phone number the
  phone id resolves to and which WABA owns it, whether the configured WABA id
  resolves, and the exact answer of the message_templates call.

  STAFF ONLY. Ids and scopes are not secrets, but they are the shop's business.
*/
export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await getCurrentUser();
  if (!isStaff(viewer?.role)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const token = whatsappToken();
  const phoneId = whatsappPhoneId();
  const wabaId = process.env.META_WHATSAPP_WABA_ID ?? "";

  const call = async (path: string) => {
    const res = await fetch(`${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token ?? "")}`, { cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; code?: number } };
    return res.ok ? json : { error: json.error?.message ?? `HTTP ${res.status}`, code: json.error?.code };
  };

  const debug = (await call(`debug_token?input_token=${encodeURIComponent(token ?? "")}`)) as {
    data?: { type?: string; app_id?: string; scopes?: string[]; granular_scopes?: { scope: string; target_ids?: string[] }[]; expires_at?: number };
    error?: string;
  };

  const [phone, waba, templates] = await Promise.all([
    call(`${phoneId}?fields=id,display_phone_number,verified_name`),
    wabaId ? call(`${wabaId}?fields=id,name,message_template_namespace`) : Promise.resolve({ error: "META_WHATSAPP_WABA_ID not set" }),
    wabaId ? call(`${wabaId}/message_templates?limit=3&fields=name,status`) : Promise.resolve({ error: "META_WHATSAPP_WABA_ID not set" }),
  ]);

  return NextResponse.json({
    graph: GRAPH,
    configured: { tokenPresent: Boolean(token), tokenPrefix: token ? token.slice(0, 4) : null, phoneId: phoneId || null, wabaId: wabaId || null },
    token: debug.error
      ? { error: debug.error }
      : {
          type: debug.data?.type,
          appId: debug.data?.app_id,
          expiresAt: debug.data?.expires_at,
          scopes: debug.data?.scopes ?? [],
          whatsappTargets: (debug.data?.granular_scopes ?? []).filter((g) => /whatsapp/.test(g.scope)),
        },
    phone,
    waba,
    templates,
  });
}
