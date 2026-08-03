"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { connectWhatsApp } from "@/app/admin/actions";

/*
  WhatsApp has no OAuth round trip — the credential is a permanent System User
  token in the environment. So "connecting" means: verify that token can
  actually see the configured phone number, then record it.

  Which is why this is a button rather than a link to /connect. Pressing it
  makes a real call to Graph; a green result means the credentials work, not
  that someone filled in an env file.
*/
export default function ConnectWhatsApp({ connected }: { connected: boolean }) {
  const [pending, start] = useTransition();

  function run() {
    start(async () => {
      const res = await connectWhatsApp();
      if ("error" in res) toast.error(res.error);
      else toast.success(`WhatsApp connected${res.number ? ` — ${res.number}` : ""}.`);
    });
  }

  return (
    <button
      onClick={run}
      disabled={pending}
      className="label-caps cursor-pointer border border-navy/30 px-3 py-1.5 text-[10px] text-navy transition-colors hover:border-navy disabled:opacity-40"
    >
      {pending ? "Verifying…" : connected ? "Re-verify" : "Connect WhatsApp"}
    </button>
  );
}
