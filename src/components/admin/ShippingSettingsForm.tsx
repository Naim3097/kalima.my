"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { disconnectEasyparcel, saveSenderSettings, saveShippingPricing } from "@/app/admin/actions";
import { Card, CardBody, CardHeader, Chip } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STATE_TO_ISO } from "@/lib/shipping/states";
import type { SenderSettings } from "@/lib/admin";

// Display names for the state picker, deduped by ISO code.
const STATES = [...new Map(
  Object.entries(STATE_TO_ISO).map(([name, iso]) => [
    iso,
    name.replace(/\b\w/g, (c) => c.toUpperCase()),
  ]),
).values()].sort();

/*
  EasyParcel connection + pickup address.

  EasyParcel here is an ADMIN convenience: it books the parcel and returns the
  AWB so nobody has to re-type an address on easyparcel.com. What the CUSTOMER
  pays is the separate card at the top: a flat rate, and an optional spend that
  earns free shipping.

  Those two live here rather than in Settings because this is the page someone
  opens when they are thinking about delivery — and a promotion that has to be
  hunted for in a general settings screen is a promotion left switched on after
  it ends.
*/
export function ShippingSettingsForm({ settings }: { settings: SenderSettings }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [enabled, setEnabled] = useState(settings.easyparcelEnabled);
  const [fallback, setFallback] = useState(settings.fallbackEnabled);
  const [name, setName] = useState(settings.senderName ?? "");
  const [phone, setPhone] = useState(settings.senderPhone ?? "");
  const [line1, setLine1] = useState(settings.senderLine1 ?? "");
  const [line2, setLine2] = useState(settings.senderLine2 ?? "");
  const [city, setCity] = useState(settings.senderCity ?? "");
  const [postcode, setPostcode] = useState(settings.senderPostcode ?? "");
  const [state, setState] = useState(settings.senderState ?? "Selangor");

  /* Held in RINGGIT for typing; the store keeps sen, so both convert on save.
     An empty threshold reads as 0, which is how the promotion is turned off. */
  const [westRm, setWestRm] = useState((settings.shippingWestSen / 100).toFixed(2));
  const [eastRm, setEastRm] = useState((settings.shippingEastSen / 100).toFixed(2));
  const [freeRm, setFreeRm] = useState(
    settings.freeShippingThresholdSen > 0 ? (settings.freeShippingThresholdSen / 100).toFixed(2) : "",
  );

  function save() {
    startTransition(async () => {
      const res = await saveSenderSettings({
        easyparcelEnabled: enabled, fallbackEnabled: fallback,
        senderName: name, senderPhone: phone, senderLine1: line1, senderLine2: line2,
        senderCity: city, senderPostcode: postcode, senderState: state,
      });
      if ("error" in res) toast.error(res.error);
      else {
        toast.success("Shipping settings saved.");
        router.refresh();
      }
    });
  }

  function savePricing() {
    startTransition(async () => {
      const res = await saveShippingPricing({
        shippingWestSen: Math.round(Number(westRm || 0) * 100),
        shippingEastSen: Math.round(Number(eastRm || 0) * 100),
        freeShippingThresholdSen: Math.round(Number(freeRm || 0) * 100),
      });
      if ("error" in res) toast.error(res.error);
      else {
        toast.success("Shipping charges saved.");
        router.refresh();
      }
    });
  }

  function disconnect() {
    startTransition(async () => {
      const res = await disconnectEasyparcel();
      if ("error" in res) toast.error(res.error);
      else {
        toast.success("EasyParcel disconnected.");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="What customers pay" />
        <CardBody>
        <p className="mb-4 text-[13px] tracking-wide text-navy-400">
          Malaysian orders pay by zone. Overseas orders pay the courier the customer picks at
          checkout, so there is nothing to set for them here.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ship-west" className="label-caps text-navy-400">
              Semenanjung (RM)
            </Label>
            <Input
              id="ship-west"
              type="number"
              min={0}
              step="0.01"
              value={westRm}
              onChange={(e) => setWestRm(e.target.value)}
              placeholder="10.00"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ship-east" className="label-caps text-navy-400">
              Sabah &amp; Sarawak (RM)
            </Label>
            <Input
              id="ship-east"
              type="number"
              min={0}
              step="0.01"
              value={eastRm}
              onChange={(e) => setEastRm(e.target.value)}
              placeholder="15.00"
            />
            {/* The one people file with Kuala Lumpur and Putrajaya because it is
                a federal territory — but couriers price it as East. */}
            <p className="text-[12px] tracking-wide text-navy-400">
              Labuan is charged at this rate.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-2 sm:w-1/2 sm:pr-2">
          <Label htmlFor="ship-free" className="label-caps text-navy-400">
            Free shipping above (RM)
          </Label>
          <Input
            id="ship-free"
            type="number"
            min={0}
            step="0.01"
            value={freeRm}
            onChange={(e) => setFreeRm(e.target.value)}
            placeholder="No free shipping"
          />
          {/* Empty is the normal state: the shop charges for delivery. The field
              stays so a promotion can be run without a deploy, and applies to
              Malaysian orders only — an overseas parcel can cost more than the
              goods. */}
          <p className="text-[12px] tracking-wide text-navy-400">
            Leave empty to charge everyone. Applies to Malaysian orders only.
          </p>
        </div>

        {/* Says the rule back in plain words, because "0" and "empty" are the
            same instruction here and neither looks like one. */}
        <p className="mt-4 text-[13px] tracking-wide text-navy">
          {Number(freeRm) > 0
            ? `Malaysian orders of RM${Number(freeRm).toFixed(2)} or more ship free. Below that, RM${Number(westRm || 0).toFixed(2)} to Semenanjung and RM${Number(eastRm || 0).toFixed(2)} to Sabah & Sarawak.`
            : `RM${Number(westRm || 0).toFixed(2)} to Semenanjung, RM${Number(eastRm || 0).toFixed(2)} to Sabah & Sarawak. Overseas pays the chosen courier.`}
        </p>
        <p className="mt-1 text-[12px] tracking-wide text-navy-400">
          A free-shipping discount code still applies whatever this says.
        </p>

        <div className="mt-5">
          <Button type="button" variant="kalima" size="editorial" disabled={pending} onClick={savePricing}>
            {pending ? "Saving…" : "Save charges"}
          </Button>
        </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="EasyParcel account"
          action={
            settings.connected ? (
              <Button type="button" variant="kalimaOutline" size="editorial" disabled={pending} onClick={disconnect}>
                Disconnect
              </Button>
            ) : (
              <Button asChild variant="kalima" size="editorial">
                <a href="/api/shipping/connect">Connect EasyParcel</a>
              </Button>
            )
          }
        />
        <CardBody>
        <div className="flex items-center gap-3">
          <Chip>{settings.connected ? "connected" : "not connected"}</Chip>
          <p className="text-[13px] tracking-wide text-navy-400">
            {settings.connected
              ? "Parcels can be booked from an order without opening easyparcel.com."
              : "Connect the store's EasyParcel account to book parcels from here."}
          </p>
        </div>
        <p className="mt-3 text-[12px] tracking-wide text-navy-400">
          This does not change what customers pay — that is the card above. Booking a
          courier is Kalima&apos;s own cost, paid from the EasyParcel wallet.
        </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Pickup address" />
        <CardBody>
        <p className="mb-4 text-[13px] tracking-wide text-navy-400">
          Where the courier collects. The postcode and state decide the rate, so an
          incorrect one misprices every quote.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="s-name">Contact name</Label>
            <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="s-phone">Contact phone</Label>
            <Input id="s-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="s-line1">Address line 1</Label>
            <Input id="s-line1" value={line1} onChange={(e) => setLine1(e.target.value)} className="mt-1" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="s-line2">Address line 2</Label>
            <Input id="s-line2" value={line2} onChange={(e) => setLine2(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="s-city">City</Label>
            <Input id="s-city" value={city} onChange={(e) => setCity(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="s-postcode">Postcode</Label>
            <Input id="s-postcode" value={postcode} onChange={(e) => setPostcode(e.target.value)} inputMode="numeric" className="mt-1" />
          </div>
          <div>
            <Label>State</Label>
            <Select value={state} onValueChange={setState}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-5 space-y-2 border-t border-navy-100 pt-4">
          <div className="flex items-center gap-2">
            <Checkbox id="ep-on" checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
            <Label htmlFor="ep-on" className="cursor-pointer text-[13px] font-normal">
              Use EasyParcel to book parcels
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="ep-fb" checked={fallback} onCheckedChange={(v) => setFallback(v === true)} />
            <Label htmlFor="ep-fb" className="cursor-pointer text-[13px] font-normal">
              Keep selling if EasyParcel is unreachable
            </Label>
          </div>
          <p className="text-[11px] tracking-wide text-navy-400">
            Parcels can always be recorded by hand with a consignment number, whether or not
            EasyParcel is connected.
          </p>
        </div>

        <div className="mt-5">
          <Button type="button" variant="kalima" size="editorial" disabled={pending} onClick={save}>
            {pending ? "Saving…" : "Save shipping settings"}
          </Button>
        </div>
        </CardBody>
      </Card>
    </div>
  );
}
