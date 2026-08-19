import "server-only";

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
  collectionDate?: string; // YYYY-MM-DD
  sender: PartyAddress;
  receiver: PartyAddress;
  totalWeightKg: number;
  parcelValue: number;
  content: string;
  cod?: boolean;
};

export type PartyAddress = {
  name: string;
  phone: string;
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

  /** Books the shipment and debits the merchant wallet. */
  async submitOrder(input: BookingInput): Promise<BookingResult> {
    const party = (p: PartyAddress) => ({
      name: p.name,
      phone: p.phone,
      address_line_1: p.line1,
      address_line_2: p.line2 ?? "",
      city: p.city,
      postcode: p.postcode,
      state: p.state,
      country: p.country ?? "MY",
    });

    /* PATH corrected to the spec (POST /shipment/orders). The BODY below is
       still the one inherited from the other platform's document and has never
       been validated against a real response — confirm it against the sandbox
       before the first live booking. */
    const json = await this.request<Record<string, unknown>>("/shipment/orders", {
      method: "POST",
      body: JSON.stringify({
        reference: input.reference,
        service_id: input.serviceId,
        collection_date: input.collectionDate,
        sender: party(input.sender),
        receiver: party(input.receiver),
        total_weight: input.totalWeightKg,
        parcel_value: input.parcelValue,
        content: input.content,
        features: { email_tracking: true, ...(input.cod ? { cod: true } : {}) },
      }),
    });

    const d = ((json?.data as Record<string, unknown>) ?? json ?? {}) as Record<string, unknown>;
    const shipmentId = pick<string>(d, "shipment_id", "shipmentId", "order_number", "id");
    if (!shipmentId) {
      throw new EasyParcelError("EasyParcel returned no shipment id", undefined, json);
    }
    return {
      shipmentId: String(shipmentId),
      trackingNo: (pick<string>(d, "awb_number", "awb", "tracking_number", "consignment_no") ?? null) as string | null,
      courierName: (pick<string>(d, "courier_name", "courier") ?? null) as string | null,
      serviceName: (pick<string>(d, "service_name", "service") ?? null) as string | null,
      priceSen: toSen(pick(d, "price", "amount", "total_price")),
    };
  }

  /* DELETE /shipment/orders/{shipment_id} — the id is in the path, not a body,
     which is why this sends none. */
  async cancelOrder(shipmentId: string): Promise<void> {
    await this.request(`/shipment/orders/${encodeURIComponent(shipmentId)}`, {
      method: "DELETE",
    });
  }

  /** Merchant wallet balance in sen — checked before booking so an empty
      wallet produces "top up", not a raw upstream error. */
  async getWalletBalanceSen(): Promise<number> {
    const json = await this.request<Record<string, unknown>>("/account/wallet");
    const d = ((json?.data as Record<string, unknown>) ?? json ?? {}) as Record<string, unknown>;
    return toSen(pick(d, "balance", "wallet_balance", "amount"));
  }

  async getTracking(awb: string): Promise<TrackingEvent[]> {
    /* GET /shipment/tracking with the AWB as a query parameter — it is not a
       path segment, which is how this was previously written. */
    const json = await this.request<Record<string, unknown>>(
      `/shipment/tracking?awb=${encodeURIComponent(awb)}`,
    );
    const d = (json?.data as Record<string, unknown>) ?? {};
    const raw = (d?.events ?? d?.tracking ?? json?.events ?? []) as unknown[];
    return (Array.isArray(raw) ? raw : []).map((e) => {
      const o = e as Record<string, unknown>;
      return {
        status: String(pick(o, "status", "current_status") ?? ""),
        description: String(pick(o, "description", "remark", "message") ?? ""),
        at: (pick<string>(o, "timestamp", "date", "datetime", "created_at") ?? null) as string | null,
      };
    });
  }
}
