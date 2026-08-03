"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { disconnectEasyparcel, saveSenderSettings } from "@/app/admin/actions";
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
  AWB so nobody has to re-type an address on easyparcel.com. It does NOT price
  the customer's checkout — that stays the store's flat rate / free-shipping
  threshold, set in Settings.
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
          This does not change what customers pay. Checkout still charges the flat rate
          (or free above the threshold) set in Settings — booking a courier is Kalima&apos;s
          own cost, paid from the EasyParcel wallet.
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
