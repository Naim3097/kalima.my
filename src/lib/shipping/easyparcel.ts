import "server-only";

/*
  EasyParcel API client — Malaysian shipping aggregator.

  Implemented against EASYPARCEL_INTEGRATION.md. That document describes a
  multi-tenant SaaS where every call is made with a specific store owner's
  token; Kalima is a SINGLE store, so there is one merchant account and the
  token comes from store_settings. The HTTP contract is identical.

  All money crossing this boundary is converted to integer SEN immediately.
  EasyParcel quotes prices as decimal strings/numbers in ringgit; letting a
  float reach the order maths is exactly the bug the sen convention exists to
  prevent.
*/

const API_BASE = "https://api.easyparcel.com/open_api/2026-03";
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
  /** Integer sen — the authoritative price. */
  amountSen: number;
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
    Live rates from every courier serving the lane. Response shapes vary by
    account, so each option is read defensively by field aliases — the same
    lesson the LeanX bank list taught us.
  */
  async getQuotations(input: QuotationInput): Promise<QuotationOption[]> {
    const body = {
      sender_postcode: input.senderPostcode,
      sender_state: input.senderState,
      receiver_postcode: input.receiverPostcode,
      receiver_state: input.receiverState,
      receiver_country: input.receiverCountry ?? "MY",
      total_weight: input.totalWeightKg,
      dimensions: input.dimensions ?? { width: 10, height: 10, length: 10 },
      parcel_value: input.parcelValue,
    };

    const json = await this.request<Record<string, unknown>>("/shipment/quotations", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const raw =
      (json?.data as unknown[]) ??
      ((json?.data as Record<string, unknown>)?.quotations as unknown[]) ??
      (json?.quotations as unknown[]) ??
      [];

    return (Array.isArray(raw) ? raw : [])
      .map((r) => {
        const o = r as Record<string, unknown>;
        const serviceId = pick<string>(o, "service_id", "serviceId", "id");
        if (!serviceId) return null;
        return {
          serviceId: String(serviceId),
          serviceName: String(pick(o, "service_name", "serviceName", "name") ?? "Delivery"),
          courierName: String(pick(o, "courier_name", "courierName", "courier") ?? "Courier"),
          amountSen: toSen(pick(o, "price", "amount", "rate", "total_price")),
          codAvailable: Boolean(pick(o, "cod_available", "codAvailable") ?? false),
        } satisfies QuotationOption;
      })
      .filter((o): o is QuotationOption => o !== null && o.amountSen > 0);
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

    const json = await this.request<Record<string, unknown>>("/shipment/submit_orders", {
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

  async cancelOrder(shipmentId: string): Promise<void> {
    await this.request("/shipment/cancel", {
      method: "POST",
      body: JSON.stringify({ shipment_id: shipmentId }),
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
    const json = await this.request<Record<string, unknown>>(
      `/shipment/tracking/${encodeURIComponent(awb)}`,
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
