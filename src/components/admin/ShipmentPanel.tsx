"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  bookShipment,
  deleteShipment,
  fetchCourierRates,
  saveShipment,
  type CourierRate,
} from "@/app/admin/actions";
import { Card, CardHeader, Chip } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COURIERS, courierName, trackingLink } from "@/lib/couriers";
import { formatRM } from "@/lib/format";
import type { Shipment } from "@/lib/admin";

const STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "booked", label: "Booked" },
  { value: "in_transit", label: "In transit" },
  { value: "delivered", label: "Delivered" },
  { value: "returned", label: "Returned" },
  { value: "cancelled", label: "Cancelled" },
];

/*
  Parcels against an order.

  Works with any courier today — enter the consignment number and the customer
  gets a working tracking link. When EasyParcel's API is wired, a booking writes
  the same row and this panel gains a label download; nothing here has to change
  shape for that.
*/
export function ShipmentPanel({
  reference,
  shipments,
  suggestedWeightGrams,
}: {
  reference: string;
  shipments: Shipment[];
  suggestedWeightGrams: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Shipment | null>(null);

  const [courier, setCourier] = useState("jnt");
  const [trackingNo, setTrackingNo] = useState("");
  const [status, setStatus] = useState("booked");
  const [weight, setWeight] = useState(String(suggestedWeightGrams || 0));
  const [costRm, setCostRm] = useState("");
  const [notes, setNotes] = useState("");

  // EasyParcel booking state, scoped to the parcel being booked.
  const [bookingFor, setBookingFor] = useState<string | null>(null);
  const [rates, setRates] = useState<CourierRate[] | null>(null);
  const [ratesError, setRatesError] = useState<string | null>(null);
  const [chosenService, setChosenService] = useState("");

  function startNew() {
    setEditing(null);
    setCourier("jnt");
    setTrackingNo("");
    setStatus("booked");
    setWeight(String(suggestedWeightGrams || 0));
    setCostRm("");
    setNotes("");
    setOpen(true);
  }

  function startEdit(s: Shipment) {
    setEditing(s);
    setCourier(s.courier ?? "other");
    setTrackingNo(s.trackingNo ?? "");
    setStatus(s.status);
    setWeight(String(s.weightGrams));
    setCostRm(s.costSen ? (s.costSen / 100).toFixed(2) : "");
    setNotes(s.notes ?? "");
    setOpen(true);
  }

  function submit() {
    const grams = Number(weight);
    const costSen = Math.round(Number(costRm.replace(/,/g, "") || 0) * 100);
    if (!Number.isFinite(grams) || grams < 0) return toast.error("Weight must be a number.");
    if (!Number.isFinite(costSen) || costSen < 0) return toast.error("Cost must be a number.");

    startTransition(async () => {
      const res = await saveShipment({
        reference, id: editing?.id, courier, trackingNo, status,
        weightGrams: Math.round(grams), costSen, notes,
      });
      if ("error" in res) toast.error(res.error);
      else {
        toast.success(editing ? "Shipment updated." : "Shipment added.");
        setOpen(false);
        router.refresh();
      }
    });
  }

  function remove(s: Shipment) {
    startTransition(async () => {
      const res = await deleteShipment(s.id, reference);
      if ("error" in res) toast.error(res.error);
      else {
        toast.success("Shipment removed.");
        router.refresh();
      }
    });
  }

  /* ---- EasyParcel booking ---- */

  function loadRates(s: Shipment) {
    setBookingFor(s.id);
    setRates(null);
    setRatesError(null);
    startTransition(async () => {
      const res = await fetchCourierRates(reference);
      if ("error" in res) setRatesError(res.error);
      else {
        setRates(res.rates);
        // Cheapest is the usual choice, so pre-select it.
        setChosenService(res.rates[0]?.serviceId ?? "");
      }
    });
  }

  function book(shipmentId: string) {
    if (!chosenService) return toast.error("Pick a courier first.");
    startTransition(async () => {
      const res = await bookShipment({ reference, shipmentId, serviceId: chosenService });
      if ("error" in res) toast.error(res.error);
      else {
        toast.success(res.trackingNo ? `Booked — AWB ${res.trackingNo}` : "Parcel booked.");
        setBookingFor(null);
        setRates(null);
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader
        title="Shipping"
        action={
          !open ? (
            <Button type="button" variant="kalimaOutline" size="editorial" onClick={startNew}>
              Add parcel
            </Button>
          ) : undefined
        }
      />

      {shipments.length === 0 && !open && (
        <p className="text-[13px] tracking-wide text-navy-400">
          No parcel recorded yet. Add one with its consignment number and the customer
          gets a tracking link on their order.
        </p>
      )}

      {shipments.length > 0 && (
        <ul className="space-y-3">
          {shipments.map((s) => {
            const link = trackingLink(s.courier, s.trackingNo, s.trackingUrl);
            return (
              <li key={s.id} className="rounded border border-navy-100 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Chip>{s.status.replace("_", " ")}</Chip>
                    <span className="text-[13px] font-medium">
                      {courierName(s.courier) ?? "Courier not set"}
                    </span>
                    {s.trackingNo && (
                      <span className="font-mono text-[12px] text-navy-400">{s.trackingNo}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {link && (
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="label-caps text-[11px] text-navy-400 hover:text-navy"
                      >
                        Track ↗
                      </a>
                    )}
                    {s.labelUrl && (
                      <a
                        href={s.labelUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="label-caps text-[11px] text-navy-400 hover:text-navy"
                      >
                        Label ↗
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => startEdit(s)}
                      className="label-caps text-[11px] text-navy-400 hover:text-navy"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => remove(s)}
                      className="label-caps text-[11px] text-navy-400 hover:text-navy"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-[11px] tracking-wide text-navy-400">
                  {s.weightGrams > 0 ? `${s.weightGrams} g` : "weight not set"}
                  {s.costSen > 0 ? ` · ${formatRM(s.costSen / 100)}` : ""}
                  {s.provider !== "manual" ? ` · ${s.provider}` : ""}
                  {s.notes ? ` · ${s.notes}` : ""}
                </p>

                {/* Only an un-booked parcel can be sent to EasyParcel. */}
                {s.status === "pending" && (
                  <div className="mt-3 border-t border-navy-100 pt-3">
                    {bookingFor !== s.id ? (
                      <Button
                        type="button"
                        variant="kalimaOutline"
                        size="editorial"
                        disabled={pending}
                        onClick={() => loadRates(s)}
                      >
                        Book with EasyParcel
                      </Button>
                    ) : ratesError ? (
                      <div>
                        <p className="text-[12px] tracking-wide text-red-800">{ratesError}</p>
                        <button
                          type="button"
                          onClick={() => setBookingFor(null)}
                          className="label-caps mt-2 text-[11px] text-navy-400 hover:text-navy"
                        >
                          Close
                        </button>
                      </div>
                    ) : !rates ? (
                      <p className="text-[12px] tracking-wide text-navy-400">Fetching rates…</p>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-[11px] tracking-wide text-navy-400">
                          Kalima&apos;s cost, charged to the EasyParcel wallet — cheapest first.
                        </p>
                        <ul className="space-y-1.5">
                          {rates.map((r) => (
                            <li key={r.serviceId}>
                              <label className="flex cursor-pointer items-center justify-between gap-3 rounded border border-navy-100 px-3 py-2 text-[13px] hover:border-navy-400">
                                <span className="flex items-center gap-2">
                                  <input
                                    type="radio"
                                    name={`courier-${s.id}`}
                                    value={r.serviceId}
                                    checked={chosenService === r.serviceId}
                                    onChange={() => setChosenService(r.serviceId)}
                                  />
                                  <span>{r.courierName}</span>
                                  <span className="text-navy-400">{r.serviceName}</span>
                                </span>
                                <span className="tabular-nums">{formatRM(r.amountSen / 100)}</span>
                              </label>
                            </li>
                          ))}
                        </ul>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="kalima"
                            size="editorial"
                            disabled={pending}
                            onClick={() => book(s.id)}
                          >
                            {pending ? "Booking…" : "Confirm booking"}
                          </Button>
                          <Button
                            type="button"
                            variant="kalimaOutline"
                            size="editorial"
                            disabled={pending}
                            onClick={() => setBookingFor(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <div className="mt-4 space-y-4 border-t border-navy-100 pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Courier</Label>
              <Select value={courier} onValueChange={setCourier}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COURIERS.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="ship-tracking">Consignment number</Label>
              <Input
                id="ship-tracking"
                value={trackingNo}
                onChange={(e) => setTrackingNo(e.target.value)}
                placeholder="e.g. 630123456789"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="ship-weight">Weight (g)</Label>
              <Input
                id="ship-weight"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                inputMode="numeric"
                className="mt-1"
              />
              <p className="mt-1 text-[11px] tracking-wide text-navy-400">
                {suggestedWeightGrams > 0
                  ? `Catalog weight for this order: ${suggestedWeightGrams} g`
                  : "No variant weights set — add them on the product to auto-fill this."}
              </p>
            </div>
            <div>
              <Label htmlFor="ship-cost">Postage cost (RM)</Label>
              <Input
                id="ship-cost"
                value={costRm}
                onChange={(e) => setCostRm(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="ship-notes">Notes</Label>
              <Input
                id="ship-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="kalima" size="editorial" disabled={pending} onClick={submit}>
              {pending ? "Saving…" : editing ? "Save parcel" : "Add parcel"}
            </Button>
            <Button
              type="button"
              variant="kalimaOutline"
              size="editorial"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
          <p className="text-[11px] tracking-wide text-navy-400">
            Marking a parcel booked, in transit or delivered also moves a paid order to
            fulfilled.
          </p>
        </div>
      )}
    </Card>
  );
}
