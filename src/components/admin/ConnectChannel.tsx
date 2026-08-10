"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { connectMetaChannel } from "@/app/admin/actions";

/*
  No Meta messaging channel has an OAuth round trip — the credential is a
  permanent token in the environment. So "connecting" means: verify that token
  can actually see the configured id, then record it.

  Which is why this is a button rather than a link to /connect. Pressing it
  makes a real call to Graph; a green result means the credentials work, not
  that someone filled in an env file.
*/
export default function ConnectChannel({
  channel,
  label,
  connected,
}: {
  channel: "whatsapp" | "instagram" | "facebook";
  label: string;
  connected: boolean;
}) {
  const [pending, start] = useTransition();

  function run() {
    start(async () => {
      const res = await connectMetaChannel(channel);
      if ("error" in res) toast.error(res.error);
      else toast.success(`${label} connected${res.name ? ` — ${res.name}` : ""}.`);
    });
  }

  return (
    <button
      onClick={run}
      disabled={pending}
      className="label-caps cursor-pointer border border-navy/30 px-3 py-1.5 text-[10px] text-navy transition-colors hover:border-navy disabled:opacity-40"
    >
      {pending ? "Verifying…" : connected ? "Re-verify" : `Connect ${label}`}
    </button>
  );
}
