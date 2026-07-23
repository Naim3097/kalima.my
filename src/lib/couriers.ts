/*
  Malaysian courier registry.

  Tracking URLs are built from a template so a consignment number entered in the
  admin becomes a working link for the customer, whoever booked the parcel. This
  is deliberately independent of any booking API: it works for a counter-dropped
  parcel today, and EasyParcel bookings will reuse the same table by setting
  `courier` to one of these codes.

  `id` values are stable and stored on the shipment row — renaming a label is
  safe, changing an id is not.
*/
export type Courier = {
  id: string;
  name: string;
  /** `{n}` is replaced with the consignment number. Null = no public tracker. */
  trackingUrl: string | null;
};

export const COURIERS: Courier[] = [
  { id: "jnt",       name: "J&T Express",   trackingUrl: "https://www.jtexpress.my/tracking?billcode={n}" },
  { id: "poslaju",   name: "Pos Laju",      trackingUrl: "https://track.pos.com.my/postal-services/quick-access/?track-trace={n}" },
  { id: "citylink",  name: "City-Link",     trackingUrl: "https://www.citylinkexpress.com/tracking-result/?track={n}" },
  { id: "dhl",       name: "DHL eCommerce", trackingUrl: "https://ecommerceportal.dhl.com/track/?ref={n}" },
  { id: "flash",     name: "Flash Express", trackingUrl: "https://www.flashexpress.my/tracking/?se={n}" },
  { id: "ninjavan",  name: "Ninja Van",     trackingUrl: "https://www.ninjavan.co/en-my/tracking?id={n}" },
  { id: "skynet",    name: "SkyNet",        trackingUrl: "https://www.skynet.com.my/track-shipment?consignment={n}" },
  { id: "gdex",      name: "GDEX",          trackingUrl: "https://web.gdexpress.com/official/etracking2.php?capture={n}" },
  { id: "shopeexp",  name: "Shopee Express", trackingUrl: "https://spx.com.my/track?tracking_number={n}" },
  { id: "other",     name: "Other courier", trackingUrl: null },
];

export function courierById(id: string | null | undefined): Courier | undefined {
  if (!id) return undefined;
  return COURIERS.find((c) => c.id === id);
}

export function courierName(id: string | null | undefined): string | null {
  return courierById(id)?.name ?? (id || null);
}

/*
  Resolves the link a customer clicks. An explicit URL stored on the shipment
  always wins — a gateway booking may hand back its own tracking page, and that
  is more authoritative than our template.
*/
export function trackingLink(
  courierId: string | null | undefined,
  trackingNo: string | null | undefined,
  explicitUrl?: string | null,
): string | null {
  if (explicitUrl) return explicitUrl;
  if (!trackingNo) return null;
  const template = courierById(courierId)?.trackingUrl;
  return template ? template.replace("{n}", encodeURIComponent(trackingNo)) : null;
}
