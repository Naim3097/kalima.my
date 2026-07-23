import type { Metadata } from "next";
import { ShippingSettingsForm } from "@/components/admin/ShippingSettingsForm";
import { getSenderSettings } from "@/lib/admin";

export const metadata: Metadata = {
  title: "Shipping · Admin",
  description: "EasyParcel connection and pickup address.",
};

type Search = { searchParams: Promise<{ connected?: string; error?: string }> };

/*
  Replaces the Phase 3 demo mock-up. EasyParcel is an admin convenience — it
  books the parcel and returns the AWB so nobody re-types an address on
  easyparcel.com. It does not price the customer's checkout.
*/
export default async function AdminShippingPage({ searchParams }: Search) {
  const [{ connected, error }, settings] = await Promise.all([searchParams, getSenderSettings()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-navy">Shipping</h1>
        <p className="mt-1 text-[13px] tracking-wide text-navy-400">
          Book parcels and print labels from an order, without opening easyparcel.com.
        </p>
      </div>

      {connected && (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-[13px] tracking-wide text-emerald-900">{connected}</p>
        </div>
      )}
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-[13px] tracking-wide text-red-900">{error}</p>
        </div>
      )}

      <ShippingSettingsForm settings={settings} />
    </div>
  );
}
