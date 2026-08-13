"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveSettings } from "@/app/admin/actions";
import { Card, CardHeader } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { StoreSettings } from "@/lib/admin";

/*
  Store settings form. Money is stored as integer sen and tax as basis points;
  the UI collects RM and % and converts on submit (RM → sen ×100, % → bps ×100)
  and displays the reverse (sen/100, bps/100). saveSettings revalidates
  /admin/settings and the storefront layout on success.
*/
export function SettingsForm({ settings }: { settings: StoreSettings }) {
  const [pending, startTransition] = useTransition();

  const [storeName, setStoreName] = useState(settings.storeName);
  const [storeEmail, setStoreEmail] = useState(settings.storeEmail);
  const [storePhone, setStorePhone] = useState(settings.storePhone ?? "");
  const [currency, setCurrency] = useState(settings.currency);
  // human units: RM for the two shipping fields, % for tax.
  const [freeShipping, setFreeShipping] = useState(String(settings.freeShippingThresholdSen / 100));
  const [flatShipping, setFlatShipping] = useState(String(settings.flatShippingSen / 100));
  const [taxPercent, setTaxPercent] = useState(String(settings.taxRateBps / 100));
  const [instagram, setInstagram] = useState(settings.socialInstagram);
  const [tiktok, setTiktok] = useState(settings.socialTiktok);
  const [facebook, setFacebook] = useState(settings.socialFacebook);
  const [threads, setThreads] = useState(settings.socialThreads);

  function submit() {
    if (!storeName.trim()) {
      toast.error("Store name is required.");
      return;
    }

    const freeShippingThresholdSen = freeShipping.trim() ? Math.round(Number(freeShipping) * 100) : 0;
    const flatShippingSen = flatShipping.trim() ? Math.round(Number(flatShipping) * 100) : 0;
    const taxRateBps = taxPercent.trim() ? Math.round(Number(taxPercent) * 100) : 0;

    startTransition(async () => {
      const res = await saveSettings({
        storeName,
        storeEmail,
        storePhone,
        currency,
        freeShippingThresholdSen,
        flatShippingSen,
        taxRateBps,
        socialInstagram: instagram,
        socialTiktok: tiktok,
        socialFacebook: facebook,
        socialThreads: threads,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Settings saved.");
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Store info" />
        <div className="grid gap-5 px-5 py-5 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="set-name" className="label-caps text-navy-400">
              Store name
            </Label>
            <Input
              id="set-name"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder="Kalima"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="set-email" className="label-caps text-navy-400">
              Store email
            </Label>
            <Input
              id="set-email"
              type="email"
              value={storeEmail}
              onChange={(e) => setStoreEmail(e.target.value)}
              placeholder="hello@kalima.my"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="set-phone" className="label-caps text-navy-400">
              Store phone
            </Label>
            <Input
              id="set-phone"
              value={storePhone}
              onChange={(e) => setStorePhone(e.target.value)}
              placeholder="+60 12-345 6789"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="set-currency" className="label-caps text-navy-400">
              Currency
            </Label>
            <Input
              id="set-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              placeholder="MYR"
            />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Shipping & tax" />
        <div className="grid gap-5 px-5 py-5 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="set-free" className="label-caps text-navy-400">
              Free-shipping threshold (RM)
            </Label>
            <Input
              id="set-free"
              type="number"
              min={0}
              step="0.01"
              value={freeShipping}
              onChange={(e) => setFreeShipping(e.target.value)}
              placeholder="150.00"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="set-flat" className="label-caps text-navy-400">
              Flat shipping rate (RM)
            </Label>
            <Input
              id="set-flat"
              type="number"
              min={0}
              step="0.01"
              value={flatShipping}
              onChange={(e) => setFlatShipping(e.target.value)}
              placeholder="8.00"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="set-tax" className="label-caps text-navy-400">
              Tax rate (%)
            </Label>
            <Input
              id="set-tax"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={taxPercent}
              onChange={(e) => setTaxPercent(e.target.value)}
              placeholder="0"
            />
          </div>
          <p className="text-[12px] leading-relaxed tracking-wide text-navy-400 sm:col-span-3">
            Orders at or above the free-shipping threshold ship free; below it, the flat rate applies. Tax
            defaults to 0% (most MY fashion SMEs aren&apos;t SST-registered).
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Social links" />
        <div className="grid gap-5 px-5 py-5 sm:grid-cols-2">
          {(
            [
              ["set-instagram", "Instagram", instagram, setInstagram, "https://www.instagram.com/yourhandle"],
              ["set-tiktok", "TikTok", tiktok, setTiktok, "https://www.tiktok.com/@yourhandle"],
              ["set-facebook", "Facebook", facebook, setFacebook, "https://www.facebook.com/yourpage"],
              ["set-threads", "Threads", threads, setThreads, "https://www.threads.com/@yourhandle"],
            ] as const
          ).map(([id, label, value, set, placeholder]) => (
            <div key={id} className="space-y-2">
              <Label htmlFor={id} className="label-caps text-navy-400">
                {label}
              </Label>
              <Input
                id={id}
                type="url"
                value={value}
                onChange={(e) => set(e.target.value)}
                placeholder={placeholder}
              />
            </div>
          ))}
          <p className="text-[12px] leading-relaxed tracking-wide text-navy-400 sm:col-span-2">
            Shown as icons on the homepage and in the footer. Paste the full profile URL —
            leave one empty and its icon is hidden rather than linking nowhere.
          </p>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button
          variant="kalima"
          size="editorial"
          className="cursor-pointer px-4 py-2.5"
          onClick={submit}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
