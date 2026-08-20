import "server-only";

import { dialCodeFor } from "./countries";

/*
  EasyParcel API client — Malaysian shipping aggregator.

  Written against the PUBLISHED SPEC: https://easyparcel.github.io/OpenAPI/

  It was previously implemented from EASYPARCEL_INTEGRATION.md, which documents
  a DIFFERENT product (a multi-tenant SaaS fronting many merchants). The auth
  model happened to match — OAuth 2.0 authorization code against
  api.easyparcel.com — but four of the six endpoint paths did not, and the
  quotation body was a flat object where the API wants a nested `shipment`
  array. None of it had ever been called, so nothing broke; it was simply
  unverified. Check the spec, not that document, when extending this.

  Kalima is a SINGLE store: one merchant account, one token, held in
  store_settings rather than per user.

  All money crossing this boundary is converted to integer SEN immediately.
  EasyParcel quotes prices as decimal strings in ringgit; letting a float reach
  the order maths is exactly the bug the sen convention exists to prevent.
*/

/* Pinned deliberately, as the Meta client is. The spec is versioned in the
   path, so an unpinned URL means the payload shape can change under a running
   shop without a deploy. Bump consciously, after reading the changelog. */
const API_BASE = "https://api.easyparcel.com/open_api/2026-06";
export const OAUTH_BASE = "https://api.easyparcel.com/oauth";

export class EasyParcelError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = "EasyParcelError";
  }
}

/** Thrown when the store is not connected or its refresh token is dead. */
export class EasyParcelTokenError extends Error {
  readonly needsReconnect = true;
  constructor(message: string) {
    super(message);
    this.name = "EasyParcelTokenError";
  }
}

export type QuotationInput = {
  receiverPostcode: string;
  /** ISO 3166-2, e.g. "MY-10". */
  receiverState: string;
  receiverCountry?: string;
  senderPostcode: string;
  senderState: string;
  /** Defaults to MY. Present so a non-Malaysian pickup is expressible. */
  senderCountry?: string;
  /** Kilograms. EasyParcel prices on weight; never send 0. */
  totalWeightKg: number;
  dimensions?: { width: number; height: number; length: number };
  /** Declared parcel value in RINGGIT, for insurance/COD ceilings. */
  parcelValue: number;
};

export type QuotationOption = {
  serviceId: string;
  serviceName: string;
  courierName: string;
  /** Integer sen — the authoritative price, from the spec's `total_amount`
      (features and tax included, not the bare shipment_price). */
  amountSen: number;
  /** e.g. "2 - 4 working days". Often null — EasyParcel leaves it unset for
      most Malaysian services. */
  deliveryDuration: string | null;
  /** Collection method. The same courier is quoted for both, so these are what
      distinguish two otherwise identical rows. */
  isPickup: boolean;
  isDropoff: boolean;
  /** "Domestic" | "International", from the courier's own service tag. */
  destinations: string | null;
  codAvailable: boolean;
};

export type BookingInput = {
  reference: string;
  serviceId: string;
  /** YYYY-MM-DD. Required by the API; defaults to today in Kuala Lumpur. */
  collectionDate?: string;
  sender: PartyAddress;
  receiver: PartyAddress;
  totalWeightKg: number;
  /** The same tier the rate was quoted for. Booking a different box than the
      one priced is how a quote and an invoice drift apart. */
  dimensions?: { width: number; height: number; length: number };
  parcelValue: number;
  content: string;
  cod?: boolean;
};

export type PartyAddress = {
  name: string;
  phone: string;
  /** Optional per the spec, but the tracking email feature is inert without
      one, so booking only asks for email tracking when this is present. */
  email?: string;
  line1: string;
  line2?: string;
  city: string;
  postcode: string;
  /** ISO 3166-2. */
  state: string;
  country?: string;
};

export type BookingResult = {
  shipmentId: string;
  trackingNo: string | null;
  courierName: string | null;
  serviceName: string | null;
  priceSen: number;
};

export type TrackingEvent = { status: string; description: string; at: string | null };

/** Ringgit (string | number) -> integer sen, rounded. NaN-safe. */
function toSen(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function pick<T = unknown>(o: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const k of keys) {
    const v = o?.[k];
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return undefined;
}

/*
  Transit time, in words a shopper reads.

  EasyParcel returns this field in more than one shape: a plain string for some
  couriers, and `{ type: "days", value: "1" }` for others — which is how
  `{"type":"days","value":"1"}` ended up printed beside FedEx on the checkout.
  Anything unrecognised becomes null rather than a stringified object; no
  transit estimate beats a visible one made of punctuation.
*/
export function formatDuration(raw: unknown): string | null {
  if (typeof raw === "string") return raw.trim() || null;
  if (!raw || typeof raw !== "object") return null;

  const d = raw as Record<string, unknown>;
  const unit = typeof d.type === "string" ? d.type.trim().replace(/s$/, "") : null;
  if (!unit) return null;

  const num = (v: unknown) => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
    return Number.isFinite(n) ? n : null;
  };

  const min = num(d.min ?? d.from);
  const max = num(d.max ?? d.to);
  if (min !== null && max !== null) {
    return min === max ? `${min} ${unit}${min === 1 ? "" : "s"}` : `${min}\u2013${max} ${unit}s`;
  }

  const value = num(d.value);
  if (value === null) return null;
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

/*
  A phone number as EasyParcel wants it: the dialling country and the
  subscriber number in separate fields, the number carrying neither a trunk
  zero nor an international prefix. Their own examples read "1126760658", not
  "011-2676 0658" and not "+60 11-2676 0658"; shoppers type all three.

  THE PREFIX IS ONLY STRIPPED FROM A NUMBER THAT ANNOUNCED ITSELF AS
  INTERNATIONAL, with a leading + or 00. Stripping it from any number that
  merely starts with those digits mangles the locals that legitimately do —
  a Singapore landline is eight digits beginning 6, so "65123456" would lose
  its first two and become someone else's number.

  The country comes from the ADDRESS rather than the number. A Malaysian
  mobile on a Singapore delivery is a data-entry mistake this cannot fix, and
  inferring the country from the digits would turn one mistake into two.
*/
function phoneParts(p: PartyAddress): { code: string; number: string } {
  const code = (p.country ?? "MY").toUpperCase();
  const raw = (p.phone ?? "").trim();
  const international = /^\+|^00/.test(raw);

  let digits = raw.replace(/\D+/g, "");
  if (international) {
    if (digits.startsWith("00")) digits = digits.slice(2);
    const dial = dialCodeFor(code);
    if (dial && digits.startsWith(dial)) digits = digits.slice(dial.length);
  }
  if (digits.startsWith("0")) digits = digits.slice(1);

  return { code, number: digits };
}

/*
  Today where the parcel is actually collected. Taking the date from UTC would
  name yesterday for every booking made before 8am Malaysian time, and a
  collection date in the past is refused.
*/
function todayInMalaysia(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export class EasyParcelClient {
  constructor(private readonly accessToken: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${this.accessToken}`,
          ...(init?.headers ?? {}),
        },
        cache: "no-store",
      });
    } catch (e) {
      throw new EasyParcelError(
        `EasyParcel unreachable: ${e instanceof Error ? e.message : "network error"}`,
      );
    }

    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }

    if (!res.ok) {
      const msg =
        (json as Record<string, unknown>)?.message ??
        (json as Record<string, unknown>)?.error ??
        `HTTP ${res.status}`;
      // 401 means the token is bad — surface it as a reconnect, not a generic failure.
      if (res.status === 401) throw new EasyParcelTokenError(String(msg));
      throw new EasyParcelError(String(msg), res.status, json);
    }
    return json as T;
  }

  /*
    Live rates from every courier serving the lane.

    THE RESPONSE IS THREE LEVELS DEEP, and this was written twice against
    guesses before a real call settled it. Verified against a live 2026-06
    response (Selangor → Kota Kinabalu, 18 services):

      { data: [ { status, input, quotations: [
          { courier: { service_id, service_name, courier_name, delivery_duration,
                       service_tag[], is_pickup, is_dropoff },
            pricing: { currency, total_amount, shipment_price, ... },
            features: [ { cod: { available } }, { email_tracking: ... }, ... ] } ] } ] }

    `data` is an array of SHIPMENTS — one per parcel in the request — and the
    options hang off each. Reading service_id or total_amount at the top of an
    option, as an earlier version did, finds nothing at all: the call succeeds
    and the courier list comes back empty, which looks exactly like "no courier
    serves this route".

    total_amount is what the shop is charged, tax and features included.
    shipment_price alone omits them and would under-recover on every parcel.

    An option priced in anything other than MYR is DROPPED rather than
    converted: the figure becomes orders.shipping_sen, and reading a foreign
    amount as ringgit misprices the order. Every observed response is MYR even
    for international, so this is a guard, not a filter that removes anything
    real.
  */
  async getQuotations(input: QuotationInput): Promise<QuotationOption[]> {
    const dims = input.dimensions ?? { width: 10, height: 10, length: 10 };

    const json = await this.request<Record<string, unknown>>("/shipment/quotations", {
      method: "POST",
      body: JSON.stringify({
        shipment: [
          {
            sender: {
              postcode: input.senderPostcode,
              subdivision_code: input.senderState,
              country: input.senderCountry ?? "MY",
            },
            receiver: {
              postcode: input.receiverPostcode,
              subdivision_code: input.receiverState,
              country: input.receiverCountry ?? "MY",
            },
            weight: input.totalWeightKg,
            width: dims.width,
            height: dims.height,
            length: dims.length,
            parcel_value: input.parcelValue,
          },
        ],
      }),
    });

    const shipments = Array.isArray(json?.data) ? (json.data as Record<string, unknown>[]) : [];
    const raw = shipments.flatMap((sh) =>
      Array.isArray(sh?.quotations) ? (sh.quotations as Record<string, unknown>[]) : [],
    );

    return raw
      .map((o) => {
        const courier = (o?.courier ?? {}) as Record<string, unknown>;
        const pricing = (o?.pricing ?? {}) as Record<string, unknown>;

        const serviceId = pick<string>(courier, "service_id");
        if (!serviceId) return null;

        const currency = String(pick(pricing, "currency") ?? "MYR").toUpperCase();
        if (currency !== "MYR") return null;

        /* features is an array of single-key objects, not a map — find the one
           that carries `cod` rather than indexing a position that shifts. */
        const features = Array.isArray(o?.features) ? (o.features as Record<string, unknown>[]) : [];
        const cod = features.find((f) => f && typeof f === "object" && "cod" in f)?.cod as
          | Record<string, unknown>
          | undefined;

        const tags = Array.isArray(courier.service_tag)
          ? (courier.service_tag as { name?: string; value?: string }[])
          : [];
        const destinations = tags.find((t) => t?.name === "Service Destinations")?.value ?? null;

        return {
          serviceId: String(serviceId),
          serviceName: String(pick(courier, "service_name") ?? "Delivery"),
          courierName: String(pick(courier, "courier_name") ?? "Courier"),
          amountSen: toSen(pick(pricing, "total_amount")),
          deliveryDuration: formatDuration(courier.delivery_duration),
          /* Every courier is offered twice — once collecting from the door, once
             from a drop-off point, usually at the same price. The checkout shows
             one row per courier, and this is what tells them apart. */
          isPickup: Boolean(courier.is_pickup),
          isDropoff: Boolean(courier.is_dropoff),
          /* "Domestic" or "International", straight from the courier's own tag. */
          destinations: destinations as string | null,
          codAvailable: Boolean(cod?.available ?? false),
        } satisfies QuotationOption;
      })
      .filter((o): o is QuotationOption => o !== null && o.amountSen > 0)
      /* Cheapest first — that is the decision the shopper is making, and the
         API returns them in no useful order. */
      .sort((a, b) => a.amountSen - b.amountSen);
  }

  /*
    Books the shipment and debits the merchant wallet.

    WRITTEN FROM THE SPEC, NEVER YET RUN. The path, the body and the response
    reading below all come from easyparcel/OpenAPI @ 2026-06 (the "Open API
    Live" Postman collection and _submitorder.md), because the previous version
    of this method was inherited from a different product's document: it posted
    a flat object to /shipment/orders, an endpoint that does not exist. Nothing
    broke only because no booking has ever been made. Confirm this against a
    sandbox account before the first live one.

    ONE PARCEL PER CALL. `shipment` is an array and the API will happily take
    several, but a booking here is always one order's one box, and reading
    data[0].shipments[0] is honest about that rather than pretending to a
    batching this shop does not do.
  */
  async submitOrder(input: BookingInput): Promise<BookingResult> {
    const party = (p: PartyAddress) => {
      const phone = phoneParts(p);
      return {
        name: p.name,
        phone_number_country_code: phone.code,
        phone_number: phone.number,
        ...(p.email ? { email: p.email } : {}),
        address_1: p.line1,
        ...(p.line2 ? { address_2: p.line2 } : {}),
        postcode: p.postcode,
        city: p.city,
        subdivision_code: p.state,
        country_code: p.country ?? "MY",
      };
    };

    const dims = input.dimensions ?? { width: 10, height: 10, length: 10 };

    const json = await this.request<Record<string, unknown>>("/shipment/submit_orders", {
      method: "POST",
      body: JSON.stringify({
        shipment: [
          {
            reference: input.reference,
            service_id: input.serviceId,
            collection_date: input.collectionDate ?? todayInMalaysia(),
            weight: input.totalWeightKg,
            width: dims.width,
            height: dims.height,
            length: dims.length,
            /* `item` is required and describes the CONTENTS, which customs
               reads on an international parcel. One line for the whole box:
               the catalogue knows what is in it, but not what each piece
               weighs once folded, and a made-up per-item split would be a
               worse declaration than an honest single one. */
            item: [
              {
                content: input.content,
                weight: input.totalWeightKg,
                width: dims.width,
                height: dims.height,
                length: dims.length,
                currency_code: "MYR",
                value: input.parcelValue,
                quantity: 1,
              },
            ],
            sender: party(input.sender),
            receiver: party(input.receiver),
            feature: {
              email_tracking: Boolean(input.receiver.email),
              ...(input.cod
                ? { cod: { cod_amount: input.parcelValue, cod_currency: "MYR" } }
                : {}),
            },
          },
        ],
      }),
    });

    /* A 200 IS NOT A BOOKING. The response carries a per-shipment `status`,
       and the summary message counts successes and errors together ("2
       requests success, 0 request error"), so a refused parcel arrives inside
       an otherwise cheerful envelope. */
    const orders = Array.isArray(json?.data) ? (json.data as Record<string, unknown>[]) : [];
    const booked = orders.flatMap((o) =>
      Array.isArray(o?.shipments) ? (o.shipments as Record<string, unknown>[]) : [],
    );
    const first = booked[0];
    if (!first) {
      throw new EasyParcelError(
        String(pick(json, "message") ?? "EasyParcel booked no shipment"),
        undefined,
        json,
      );
    }
    if (String(first.status ?? "").toLowerCase() !== "success") {
      throw new EasyParcelError(
        String(pick(first, "message") ?? pick(json, "message") ?? "EasyParcel refused the shipment"),
        undefined,
        json,
      );
    }

    /* shipment_number, not the order number: it is what cancellation and
       tracking are keyed on. */
    const shipmentNumber = pick<string>(first, "shipment_number");
    if (!shipmentNumber) {
      throw new EasyParcelError("EasyParcel returned no shipment number", undefined, json);
    }

    const pricing = (first.pricing_breakdown ?? {}) as Record<string, unknown>;
    return {
      shipmentId: String(shipmentNumber),
      /* Null until the courier issues it — an AWB usually arrives minutes
         later, so an empty one here is normal rather than a failure. */
      trackingNo: (pick<string>(first, "awb_number") ?? null) as string | null,
      courierName: (pick<string>(first, "courier") ?? null) as string | null,
      serviceName: (pick<string>(first, "courier_service") ?? null) as string | null,
      /* What EasyParcel actually took, features and tax included. */
      priceSen: toSen(pick(pricing, "total_paid_amount")),
    };
  }

  /*
    Cancels a booked shipment.

    POST with the shipment number in a `cancel_list` body — not the DELETE
    /shipment/orders/{id} this used to send, which was another endpoint that
    does not exist. The remark is required by the API.
  */
  async cancelOrder(
    shipmentNumber: string,
    remark = "Cancelled from the Kalima back office",
  ): Promise<void> {
    const json = await this.request<Record<string, unknown>>("/shipment/cancel", {
      method: "POST",
      body: JSON.stringify({ cancel_list: [{ shipment_number: shipmentNumber, remark }] }),
    });

    /* Same trap as booking: the row carries its own status inside a 200. */
    const results = Array.isArray(json?.data) ? (json.data as Record<string, unknown>[]) : [];
    const first = results[0];
    if (first && String(first.status ?? "").toLowerCase() !== "success") {
      throw new EasyParcelError(
        String(pick(first, "message") ?? "EasyParcel refused the cancellation"),
        undefined,
        json,
      );
    }
  }

  /*
    Merchant wallet balance in sen — checked before booking so an empty wallet
    produces "top up", not a raw upstream error.

    GET /wallet, and the balance is data.wallet[], an ARRAY by currency. The
    free_credit_wallet beside it is deliberately not added in: it spends under
    rules of its own, and counting it here would clear a booking the wallet
    cannot actually pay for.
  */
  async getWalletBalanceSen(): Promise<number> {
    const json = await this.request<Record<string, unknown>>("/wallet");
    const d = ((json?.data as Record<string, unknown>) ?? {}) as Record<string, unknown>;
    const wallets = Array.isArray(d.wallet) ? (d.wallet as Record<string, unknown>[]) : [];
    const myr = wallets.find((w) => String(w?.currency ?? "MYR").toUpperCase() === "MYR");
    return toSen(pick(myr ?? {}, "balance"));
  }

  /*
    Tracking events for one AWB, newest first as the API returns them.

    POST /shipment/tracking_status with an `awb_numbers` array — the endpoint
    takes up to a hundred at a time, and this asks for one because the back
    office looks at one parcel at a time.
  */
  async getTracking(awb: string): Promise<TrackingEvent[]> {
    const json = await this.request<Record<string, unknown>>("/shipment/tracking_status", {
      method: "POST",
      body: JSON.stringify({ awb_numbers: [awb] }),
    });

    const d = ((json?.data as Record<string, unknown>) ?? {}) as Record<string, unknown>;
    const results = Array.isArray(d.results) ? (d.results as Record<string, unknown>[]) : [];
    const log = results.flatMap((r) =>
      Array.isArray(r?.status_log) ? (r.status_log as Record<string, unknown>[]) : [],
    );

    return log.map((e) => ({
      status: String(pick(e, "tracking_status") ?? ""),
      /* Where it was scanned. Often null early on, which is why it is not
         allowed to become the string "null". */
      description: String(pick(e, "location") ?? ""),
      at: (pick<string>(e, "event_date") ?? null) as string | null,
    }));
  }
}
