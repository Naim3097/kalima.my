import type { Metadata } from "next";
import { SettingsForm } from "@/components/admin/SettingsForm";
import { getStoreSettings } from "@/lib/admin";

export const metadata: Metadata = {
  title: "Settings · Admin",
  description: "Store details, shipping thresholds and tax rate.",
};

/* Server Component — loads the store settings and hands them to the client form. */
export default async function AdminSettingsPage() {
  const settings = await getStoreSettings();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-navy">Settings</h1>
        <p className="mt-1 text-[13px] tracking-wide text-navy-400">
          Store contact details, shipping thresholds and tax. Changes apply to the storefront immediately.
        </p>
      </div>

      <SettingsForm settings={settings} />
    </div>
  );
}
