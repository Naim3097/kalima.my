"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useCart, cartSubtotal } from "@/stores/cart";
import { formatRM } from "@/lib/format";
import { useMounted } from "@/hooks/useMounted";
import { placeOrder, checkDiscount, quoteCart, quoteShippingOptions } from "@/app/checkout/actions";
import { COUNTRIES, DEFAULT_COUNTRY } from "@/lib/shipping/countries";
import { track } from "@/lib/meta/track";
import type { CartRef, OrderQuote } from "@/lib/commerce";
import ProductImage from "@/components/brand/ProductImage";
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

const MY_STATES = ["Selangor", "Kuala Lumpur", "Johor", "Penang", "Perak", "Kedah", "Kelantan", "Terengganu", "Pahang", "Negeri Sembilan", "Melaka", "Perlis", "Sabah", "Sarawak", "Putrajaya", "Labuan"];

/*
  Fallback shipping figures, used only if the settings read fails. They match
  the column defaults, so a store that has never opened the Shipping screen
  quotes the same numbers create_order will charge.
*/
const FALLBACK_WEST_SHIPPING = 10; // RM — Semenanjung
const FALLBACK_EAST_SHIPPING = 15; // RM — Sabah & Sarawak

const fieldClass =
  "h-auto rounded-none border-navy/20 bg-white px-4 py-3 text-[14px] md:text-[14px] text-navy shadow-none placeholder:text-navy-300 focus-visible:border-navy focus-visible:ring-0";

/*
  Loyalty context, resolved on the server. Everything here is for DISPLAY: the
  form sends a points request and create_order decides what it is worth, so a
  tampered value can mislead this panel but never change what is charged.
*/
export type LoyaltyContext = {
  balance: number;
  senPerPoint: number;
  minRedeemPoints: number;
  maxRedeemBps: number;
  pointsPerRm: number;
  multiplierBps: number;
  tierName: string;
};

/*
  What the shop charges for delivery, read from store_settings on the server.

  Passed in rather than hardcoded because create_order reads the same two
  columns: when they were constants here, changing the shop's rate meant a
  deploy, and forgetting one left the checkout quoting a total the order would
  not honour. `freeShippingAbove` of 0 means there is no free shipping.
*/
export type ShippingPricing = {
  westRm: number;
  eastRm: number;
  freeShippingAbove: number;
  /* Malaysia priced by the courier the shopper picks (live EasyParcel pickup
     rates) rather than by zone. Overseas is always priced that way. */
  domesticCourier: boolean;
};

type Props = {
  defaultEmail?: string;
  defaultName?: string;
  defaultPhone?: string;
  loyalty?: LoyaltyContext | null;
  shipping?: ShippingPricing;
};

export default function CheckoutForm({
  defaultEmail = "",
  defaultName = "",
  defaultPhone = "",
  loyalty = null,
  shipping: pricing = {
    westRm: FALLBACK_WEST_SHIPPING, eastRm: FALLBACK_EAST_SHIPPING,
    freeShippingAbove: 0, domesticCourier: false,
  },
}: Props) {
  const mounted = useMounted();
  const { items } = useCart();
  const subtotal = cartSubtotal(items);

  const [form, setForm] = useState({
    email: defaultEmail,
    phone: defaultPhone,
    recipient: defaultName,
    line1: "",
    line2: "",
    city: "",
    postcode: "",
    state: "Selangor",
    country: DEFAULT_COUNTRY,
  });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  /*
    Client-side validation, for the shopper's benefit only — placeOrder repeats
    every one of these checks on the server, which is the actual guard. The
    point here is to stop the round trip that returns one error at a time:
    filling a nine-field form, pressing pay, and being told about the postcode,
    then the phone, then the state, is how a full bag gets abandoned.

    Messages mirror the server's wording so the same problem never gets
    described two different ways.
  */
  const [touched, setTouched] = useState<Partial<Record<keyof typeof form, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);

  const problems: Partial<Record<keyof typeof form, string>> = {};
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) {
    problems.email = "Enter a valid email address.";
  }
  /*
    The rules follow the destination. Malaysian addresses are checked exactly —
    01 mobile, five-digit postcode — because we know their shape. Applying the
    same rules to Sydney or Riyadh would reject correct addresses, so overseas
    ones are checked for presence and left alone. placeOrder repeats all of
    this; this only saves the round trip.
  */
  const overseas = form.country !== "MY";
  /* Whether delivery is a courier the shopper picks (always overseas; Malaysia
     when the shop says so) or a zone rate the summary already knows. */
  const byCourier = overseas || pricing.domesticCourier;

  if (!overseas && !/^01\d{8,9}$/.test(form.phone.replace(/\D/g, ""))) {
    problems.phone = "Malaysian mobile, e.g. 012 345 6789.";
  }
  if (overseas && form.phone.replace(/\D/g, "").length < 7) {
    problems.phone = "Include the country code, e.g. +65 8123 4567.";
  }
  if (!form.recipient.trim()) problems.recipient = "Who should we address it to?";
  if (!form.line1.trim()) problems.line1 = "Street address is required.";
  if (!form.city.trim()) problems.city = "City is required.";
  if (!overseas && !/^\d{5}$/.test(form.postcode.trim())) problems.postcode = "5 digits.";
  if (overseas && form.postcode.trim().length < 3) problems.postcode = "Postcode or ZIP.";
  if (overseas && !form.state.trim()) problems.state = "State, province or region.";

  /* Shown once a field has been left, or once pay has been pressed — never
     while someone is still part-way through typing their email. */
  const showProblem = (k: keyof typeof form) =>
    (touched[k] || submitted) && problems[k] ? problems[k] : null;
  const markTouched = (k: keyof typeof form) => () => setTouched((t) => ({ ...t, [k]: true }));

  const [code, setCode] = useState("");
  const [discount, setDiscount] = useState<{ code: string; discountSen: number; freeShipping: boolean } | null>(null);
  const [codeMsg, setCodeMsg] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();

  const [error, setError] = useState<string | null>(null);
  const [placing, startPlace] = useTransition();

  const cartRefs: CartRef[] = useMemo(
    () => items.map((i) => ({ slug: i.slug, color: i.color, size: i.size, qty: i.qty })),
    [items],
  );

  const [usePoints, setUsePoints] = useState(false);


  /*
    Mirrors the server's clamp so the shopper sees the real figure before
    committing: capped by their balance, by the scheme's share of the goods
    value, and by what is actually left to pay. The server recomputes all of
    this — this is a preview, not the decision.
  */
  /*
    THE PRICE COMES FROM THE SERVER, and that is the point.

    Everything below the subtotal — the code, the new-member discount, the
    loyalty clamp, the shipping threshold, the rule that the first two never
    stack — used to be recomputed here in TypeScript alongside the same rules in
    SQL. Two implementations of one price agree only until one of them is
    edited. quoteCart calls the very price_order() that create_order will use,
    so the summary and the charge are the same arithmetic by construction.

    The subtotal stays local: it is the sum of the lines already on screen, it
    needs no server to be right, and having it instantly means the panel never
    shows nothing while a quote is in flight.
  */
  /*
    Overseas delivery: a list of couriers, and which one was picked.

    `quoteId` is opaque — the server froze the prices behind it and reads them
    back when the order is priced. Nothing here holds an amount the checkout
    could send; the figures below are for DISPLAY, and the summary's shipping
    line comes from the server quote like every other figure.
  */
  const [courierOptions, setCourierOptions] = useState<
    { serviceId: string; label: string; courier: string; amountSen: number; duration: string | null }[]
  >([]);
  const [shipQuoteId, setShipQuoteId] = useState<string | null>(null);
  const [chosenService, setChosenService] = useState<string | null>(null);
  const [courierError, setCourierError] = useState<string | null>(null);
  const [fetchingRates, setFetchingRates] = useState(false);

  /* An address good enough to quote against. Below this the courier call would
     only fail, and asking EasyParcel on every keystroke spends the shop's
     quota. */
  const addressQuotable = byCourier && (
    overseas
      ? form.postcode.trim().length >= 3 && form.city.trim().length > 0
      /* A Malaysian rate needs only the postcode and state — both of which the
         shop validates exactly, so a quote is never sent for a half-typed one. */
      : /^\d{5}$/.test(form.postcode.trim()) && MY_STATES.includes(form.state)
  );

  /*
    Quoted as the address is typed, not on a button, because a Malaysian
    shopper expects the list to simply appear — and the debounce keeps a
    postcode typed digit by digit from becoming five EasyParcel calls.
  */
  const quotableKey = JSON.stringify({
    ok: addressQuotable, country: form.country, postcode: form.postcode.trim(), state: form.state,
    cart: cartRefs,
  });
  useEffect(() => {
    if (!addressQuotable) return;
    const timer = setTimeout(() => { void getDeliveryOptions(); }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialised inputs above
  }, [quotableKey]);

  async function getDeliveryOptions() {
    setFetchingRates(true);
    setCourierError(null);
    /* A fresh quote invalidates the old choice — pairing a stale service with a
       new quote is exactly the mismatch freezing exists to prevent. */
    setChosenService(null);
    setShipQuoteId(null);
    setCourierOptions([]);

    const res = await quoteShippingOptions(cartRefs, {
      country: form.country,
      postcode: form.postcode,
      state: form.state,
    });
    setFetchingRates(false);

    if ("error" in res) {
      setCourierError(res.error);
      return;
    }
    setCourierOptions(res.options);
    setShipQuoteId(res.quoteId);
    /* One option is not a choice. Pre-selecting it means the total is final
       the moment the address is, which is what a Malaysian shopper on the
       single-courier setting expects to see. */
    if (res.options.length === 1) setChosenService(res.options[0].serviceId);
  }

  /*
    Changing the destination retires whatever was quoted for the old one — and
    the subdivision with it. "Selangor" left sitting in a Singapore address is
    not a small cosmetic leftover: it is what gets printed on the label.
  */
  const firstRender = useRef(true);
  useEffect(() => {
    setCourierOptions([]);
    setShipQuoteId(null);
    setChosenService(null);
    setCourierError(null);
    /* Not on mount, or a signed-in shopper's saved state would be wiped before
       they had touched anything. */
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setForm((f) => ({ ...f, state: "" }));
  }, [form.country]);

  /*
    InitiateCheckout — the shopper reached this page with something in the bag.

    GATED ON A NON-EMPTY BAG, and on `mounted`, because this component renders
    for an empty one too (it shows "Your bag is empty" below). Firing on the
    bare mount would report a checkout every time someone landed here by
    accident, and the cart is read from localStorage so it is empty on the first
    render regardless.

    Fires once per visit, not per cart edit: adding a second piece is an
    AddToCart, not a second checkout.
  */
  const reportedCheckout = useRef(false);
  useEffect(() => {
    if (!mounted || items.length === 0 || reportedCheckout.current) return;
    reportedCheckout.current = true;
    track("InitiateCheckout", {
      items: items.map((i) => ({ slug: i.slug, qty: i.qty })),
    });
  }, [mounted, items]);

  const [quote, setQuote] = useState<OrderQuote | null>(null);
  const [quoting, setQuoting] = useState(false);

  /*
    The destination is part of the price now — Semenanjung and East Malaysia
    differ — so the state belongs in the key that triggers a re-quote. Editing
    an address changes the total, which was not true when shipping was flat.
  */
  const quoteKey = JSON.stringify({
    cart: cartRefs,
    code: discount?.code ?? null,
    points: usePoints,
    state: form.state,
    country: form.country,
    /* The chosen courier IS the shipping price overseas, so the summary has to
       re-price when it changes. */
    quoteId: shipQuoteId,
    serviceId: chosenService,
  });

  useEffect(() => {
    if (cartRefs.length === 0) {
      setQuote(null);
      return;
    }

    /* Debounced and cancellable: a quantity stepper fires several changes in a
       second, and only the last answer should reach the screen. */
    let cancelled = false;
    setQuoting(true);
    const timer = setTimeout(async () => {
      const res = await quoteCart(cartRefs, {
        country: form.country,
        state: form.state,
        quoteId: shipQuoteId,
        serviceId: chosenService,
        discountCode: discount?.code,
        /* A request, not a price. price_order clamps it against the real
           balance exactly as create_order does. */
        redeemPoints: usePoints && loyalty ? loyalty.balance : 0,
      });
      if (cancelled) return;
      setQuote("error" in res ? null : res);
      setQuoting(false);
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialised inputs above
  }, [quoteKey]);

  const discountRM = (quote?.discountSen ?? 0) / 100;
  const firstOrderRM = (quote?.firstOrderDiscountSen ?? 0) / 100;
  const pointsRM = (quote?.loyaltyDiscountSen ?? 0) / 100;
  const pointsUsed = quote?.loyaltyPointsUsed ?? 0;
  const freeShipping = quote?.freeShipping ?? false;
  const shipping = (quote?.shippingSen ?? 0) / 100;
  /*
    Overseas, before a courier is picked, price_order returns zero shipping and
    flags the order unpriceable. Rendering that zero would read as free delivery
    and understate the total — the one claim this shop does not make. So the
    line asks for the choice instead, and the total waits for it.
  */
  const shippingPending = quote?.requiresShippingSelection ?? false;
  /* Until the first quote lands, the goods themselves are the honest figure to
     show — never a total that omits shipping and pretends to be final. */
  const total = quote ? quote.totalSen / 100 : subtotal;

  // What this order will earn once complete, at the shopper's current tier.
  const pointsEarned = loyalty
    ? Math.floor(
        (Math.floor((subtotal - discountRM - firstOrderRM - pointsRM)) * loyalty.pointsPerRm * loyalty.multiplierBps) / 10000,
      )
    : 0;

  function applyCode() {
    const trimmed = code.trim();
    if (!trimmed) return;
    setCodeMsg(null);
    startCheck(async () => {
      const res = await checkDiscount(trimmed, cartRefs);
      if (res.valid) {
        setDiscount({ code: res.code ?? trimmed, discountSen: res.discount_sen, freeShipping: !!res.free_shipping });
        setCodeMsg(null);
      } else {
        setDiscount(null);
        setCodeMsg(res.reason ?? "That code can't be applied.");
      }
    });
  }

  function submit() {
    setError(null);
    setSubmitted(true);

    /* Nothing leaves the browser until the form is complete — and the first
       offending field is scrolled to, since on a phone the error may well be
       above the fold the shopper is looking at. */
    const first = Object.keys(problems)[0] as keyof typeof form | undefined;
    if (first) {
      const el = document.getElementById(`co-${first}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus({ preventScroll: true });
      setError("Please complete the highlighted fields.");
      return;
    }

    /* Overseas, the courier IS the price — there is nothing to charge until one
       is chosen. The server refuses this too; saying so here saves a round trip
       and points at the section rather than at the button. */
    if (byCourier && !chosenService) {
      document.getElementById("co-postcode")?.scrollIntoView({ behavior: "smooth", block: "center" });
      setError("Please choose a delivery service before placing your order.");
      return;
    }

    startPlace(async () => {
      const result = await placeOrder(cartRefs, {
        ...form,
        shippingMethod: byCourier
          ? courierOptions.find((o) => o.serviceId === chosenService)?.courier
            ?? (overseas ? "International" : "Courier")
          : freeShipping
            ? "Standard (free)"
            : "Standard",
        redeemPoints: pointsUsed,
        discountCode: discount?.code ?? "",
        quoteId: shipQuoteId,
        serviceId: chosenService,
      });
      // Success redirects server-side; only a failure returns here.
      if (result && "error" in result) setError(result.error);
    });
  }

  if (!mounted || items.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24 text-center">
        <h1 className="font-display text-3xl text-navy">Your bag is empty</h1>
        <div className="mt-8">
          <Button asChild variant="kalima" size="editorial">
            <Link href="/collections/best-sellers">Shop Best Sellers</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="mb-8 font-display text-4xl text-navy">Checkout</h1>

      <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr]">
        {/* Left: form */}
        <div className="space-y-8">
          <section>
            <h2 className="label-caps mb-4 !text-[13px]">1 · Contact</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="co-email" className="sr-only">Email</Label>
                <Input id="co-email" type="email" placeholder="Email address" className={fieldClass}
                  value={form.email} onChange={(e) => set("email")(e.target.value)}
                  required aria-invalid={!!showProblem("email")} onBlur={markTouched("email")} />
                {showProblem("email") && (
                  <p className="mt-1 text-[12px] text-red-700">{showProblem("email")}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="co-phone" className="sr-only">Phone</Label>
                <Input id="co-phone" type="tel" placeholder="Phone / WhatsApp number" className={fieldClass}
                  value={form.phone} onChange={(e) => set("phone")(e.target.value)}
                  required aria-invalid={!!showProblem("phone")} onBlur={markTouched("phone")} />
                {showProblem("phone") && (
                  <p className="mt-1 text-[12px] text-red-700">{showProblem("phone")}</p>
                )}
              </div>
            </div>
          </section>

          <section>
            <h2 className="label-caps mb-4 !text-[13px]">2 · Delivery</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {/* First, because it decides everything below it: which fields are
                  validated how, and whether delivery is a flat zone rate or a
                  courier the shopper picks. */}
              <div className="sm:col-span-2">
                <Label htmlFor="co-country" className="sr-only">Country</Label>
                <Select value={form.country} onValueChange={set("country")}>
                  <SelectTrigger id="co-country"
                    className="w-full rounded-none border-navy/20 bg-white px-4 py-3 text-[14px] text-navy shadow-none focus-visible:border-navy focus-visible:ring-0 data-[size=default]:h-auto">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="co-recipient" className="sr-only">Recipient name</Label>
                <Input id="co-recipient" placeholder="Recipient full name" className={fieldClass}
                  value={form.recipient} onChange={(e) => set("recipient")(e.target.value)}
                  required aria-invalid={!!showProblem("recipient")} onBlur={markTouched("recipient")} />
                {showProblem("recipient") && (
                  <p className="mt-1 text-[12px] text-red-700">{showProblem("recipient")}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="co-line1" className="sr-only">Address line 1</Label>
                <Input id="co-line1" placeholder="Address line 1" className={fieldClass}
                  value={form.line1} onChange={(e) => set("line1")(e.target.value)}
                  required aria-invalid={!!showProblem("line1")} onBlur={markTouched("line1")} />
                {showProblem("line1") && (
                  <p className="mt-1 text-[12px] text-red-700">{showProblem("line1")}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="co-line2" className="sr-only">Address line 2</Label>
                <Input id="co-line2" placeholder="Address line 2 (optional)" className={fieldClass}
                  value={form.line2} onChange={(e) => set("line2")(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="co-city" className="sr-only">City</Label>
                <Input id="co-city" placeholder="City" className={fieldClass}
                  value={form.city} onChange={(e) => set("city")(e.target.value)}
                  required aria-invalid={!!showProblem("city")} onBlur={markTouched("city")} />
                {showProblem("city") && (
                  <p className="mt-1 text-[12px] text-red-700">{showProblem("city")}</p>
                )}
              </div>
              <div>
                <Label htmlFor="co-postcode" className="sr-only">Postcode</Label>
                <Input id="co-postcode" inputMode="numeric" placeholder="Postcode" className={fieldClass}
                  value={form.postcode} onChange={(e) => set("postcode")(e.target.value)}
                  required aria-invalid={!!showProblem("postcode")} onBlur={markTouched("postcode")} />
                {showProblem("postcode") && (
                  <p className="mt-1 text-[12px] text-red-700">{showProblem("postcode")}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="co-state" className="sr-only">State</Label>
                {/* A fixed list for Malaysia, because the state decides the zone
                    rate and a typo would misprice the parcel. Free text
                    everywhere else — the world's subdivisions are not a list
                    anyone should be made to scroll. */}
                {overseas ? (
                  <Input id="co-state" placeholder="State / province / region" className={fieldClass}
                    value={form.state} onChange={(e) => set("state")(e.target.value)}
                    required aria-invalid={!!showProblem("state")} onBlur={markTouched("state")} />
                ) : (
                  <Select value={form.state} onValueChange={set("state")}>
                    <SelectTrigger id="co-state"
                      className="w-full rounded-none border-navy/20 bg-white px-4 py-3 text-[14px] text-navy shadow-none focus-visible:border-navy focus-visible:ring-0 data-[size=default]:h-auto">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MY_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {overseas && showProblem("state") && (
                  <p className="mt-1 text-[12px] text-red-700">{showProblem("state")}</p>
                )}
              </div>
            </div>
            {byCourier ? (
              <div className="mt-4 border border-navy/15 bg-cream-50 px-4 py-4">
                <p className="label-caps !text-[11px] text-navy-400">Delivery service</p>

                {courierOptions.length === 0 ? (
                  <>
                    <p className="mt-2 text-[13px] leading-relaxed text-navy-400">
                      {fetchingRates
                        ? "Getting courier rates for your address…"
                        : overseas
                          ? "Rates are quoted live for your address. Fill in the city and postcode, then choose a courier."
                          : "Courier rates are quoted live once your postcode and state are filled in."}
                    </p>
                    <Button
                      type="button"
                      variant="kalimaOutline"
                      size="editorial"
                      className="mt-3"
                      disabled={!addressQuotable || fetchingRates}
                      onClick={getDeliveryOptions}
                    >
                      {fetchingRates ? "Getting rates…" : "Get delivery options"}
                    </Button>
                  </>
                ) : (
                  <>
                    <ul className="mt-3 space-y-2">
                      {courierOptions.map((o) => (
                        <li key={o.serviceId}>
                          <label
                            className={`flex cursor-pointer items-center justify-between gap-3 border px-3 py-2.5 text-[13px] transition-colors ${
                              chosenService === o.serviceId
                                ? "border-navy bg-white"
                                : "border-navy/15 hover:border-navy/40"
                            }`}
                          >
                            <span className="flex items-center gap-2.5">
                              <input
                                type="radio"
                                name="courier"
                                className="size-4 accent-navy"
                                checked={chosenService === o.serviceId}
                                onChange={() => setChosenService(o.serviceId)}
                              />
                              <span>
                                <span className="text-navy">{o.courier}</span>
                                <span className="block text-[12px] text-navy-400">
                                  {o.label}
                                  {o.duration ? ` · ${o.duration}` : ""}
                                </span>
                              </span>
                            </span>
                            <span className="shrink-0 text-navy">{formatRM(o.amountSen / 100)}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={getDeliveryOptions}
                      disabled={fetchingRates}
                      className="mt-3 cursor-pointer text-[12px] tracking-wide text-navy-400 underline underline-offset-4 hover:text-navy"
                    >
                      {fetchingRates ? "Refreshing…" : "Refresh rates"}
                    </button>
                  </>
                )}

                {/*
                  No rates is a full stop, not a guess. Quoting a flat figure for
                  an unserved country is how a shop loses more than the order is
                  worth, so the sale is offered a human instead.
                */}
                {courierError && (
                  <div className="mt-3 border border-red-200 bg-red-50 px-3 py-2.5">
                    <p className="text-[13px] text-red-800">{courierError}</p>
                    <p className="mt-1 text-[12px] text-red-800/80">
                      Message us and we will arrange it personally, or try a different address.
                    </p>
                  </div>
                )}

                {overseas && (
                  <p className="mt-3 text-[12px] tracking-wide text-navy-300">
                    Import duties and taxes, where the destination charges them, are the
                    customer&apos;s responsibility.
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-[12px] tracking-wide text-navy-300">
                {/* The policy, not this cart: the summary above already prices the
                    address they typed. Both zones are named because "delivery
                    RM10" beside a RM15 line is the contradiction this replaced. */}
                {`${formatRM(pricing.westRm)} to Semenanjung, ${formatRM(pricing.eastRm)} to Sabah & Sarawak.`}
                {pricing.freeShippingAbove > 0
                  ? ` Free over ${formatRM(pricing.freeShippingAbove)}.`
                  : ""}
              </p>
            )}
          </section>

          <section>
            <h2 className="label-caps mb-2 !text-[13px]">3 · Payment</h2>
            <p className="border border-navy/15 bg-cream-50 px-4 py-3 text-[13px] leading-relaxed text-navy-400">
              You&apos;ll choose your bank on our secure payment page to complete payment by
              FPX. Your order is confirmed once payment goes through.
            </p>
          </section>
        </div>

        {/* Right: summary */}
        <aside className="h-fit border border-navy/10 bg-white p-6">
          <h2 className="label-caps mb-5 !text-[13px]">Order Summary</h2>
          <ul className="divide-y divide-navy/5">
            {items.map((i) => (
              <li key={`${i.productId}-${i.color}-${i.size}`} className="flex gap-4 py-4">
                <ProductImage image={i.image} tone={i.tone} alt={i.name} className="h-20 w-16 shrink-0" sizes="64px" />
                <div className="flex-1 text-[13px]">
                  <p className="text-navy">{i.name}</p>
                  <p className="mt-0.5 text-navy-400">{i.color} · {i.size} × {i.qty}</p>
                </div>
                <span className="text-[13px] text-navy">{formatRM(i.price * i.qty)}</span>
              </li>
            ))}
          </ul>

          {/* Discount / affiliate code */}
          <div className="mt-4 flex gap-2">
            <Label htmlFor="co-code" className="sr-only">Discount / affiliate code</Label>
            <Input id="co-code" value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Discount / affiliate code"
              className="h-auto flex-1 rounded-none border-navy/20 bg-cream-50 px-3 py-2.5 text-[13px] text-navy shadow-none placeholder:text-navy-300 focus-visible:border-navy focus-visible:ring-0 md:text-[13px]" />
            <Button variant="kalimaOutline" size="editorial" onClick={applyCode} disabled={checking}
              className="border-navy/30 px-4 py-0 hover:border-navy">
              {checking ? "…" : "Apply"}
            </Button>
          </div>
          {discount && (
            <p className="mt-2 text-[12px] tracking-wide text-emerald-700">
              ✓ {discount.code} applied
              {discount.code.startsWith("AISYAH") && " · supporting @aisyahstyles"}
            </p>
          )}
          {codeMsg && <p className="mt-2 text-[12px] tracking-wide text-red-600">{codeMsg}</p>}

          {/* Kalima Club points */}
          {loyalty && (
            <div className="mt-4 border border-navy/10 bg-cream-50 px-4 py-3">
              {loyalty.balance < loyalty.minRedeemPoints ? (
                <p className="text-[12px] tracking-wide text-navy-400">
                  You have {loyalty.balance} Kalima Club point{loyalty.balance === 1 ? "" : "s"} —{" "}
                  {loyalty.minRedeemPoints} needed to redeem.
                </p>
              ) : (
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={usePoints}
                    onChange={(e) => setUsePoints(e.target.checked)}
                    className="mt-0.5 accent-navy"
                  />
                  <span className="text-[13px] leading-relaxed tracking-wide text-navy">
                    Use my {loyalty.balance} points
                    {pointsRM > 0 && (
                      <span className="text-navy-400">
                        {" "}— saves {formatRM(pointsRM)} on this order
                      </span>
                    )}
                    {usePoints && pointsUsed < loyalty.balance && (
                      <span className="mt-0.5 block text-[11px] text-navy-400">
                        {pointsUsed} points used · {loyalty.balance - pointsUsed} kept for next time
                      </span>
                    )}
                  </span>
                </label>
              )}
            </div>
          )}

          <dl
            className={`mt-5 space-y-2 border-t border-navy/10 pt-4 text-[13px] transition-opacity ${
              quoting ? "opacity-60" : ""
            }`}
          >
            <div className="flex justify-between text-navy-400">
              <dt>Subtotal</dt><dd>{formatRM(subtotal)}</dd>
            </div>
            {discountRM > 0 && (
              <div className="flex justify-between text-emerald-700">
                <dt>Code {discount?.code}</dt><dd>−{formatRM(discountRM)}</dd>
              </div>
            )}
            {firstOrderRM > 0 && (
              <div className="flex justify-between text-emerald-700">
                <dt>Welcome — first order</dt><dd>−{formatRM(firstOrderRM)}</dd>
              </div>
            )}
            {pointsRM > 0 && (
              <div className="flex justify-between text-emerald-700">
                <dt>Kalima Club ({pointsUsed} pts)</dt><dd>−{formatRM(pointsRM)}</dd>
              </div>
            )}
            <div className="flex justify-between text-navy-400">
              <dt>Shipping</dt>
              <dd>
                {shippingPending
                  ? "Choose a courier"
                  : freeShipping
                    ? "FREE"
                    : formatRM(shipping)}
              </dd>
            </div>
            <div className="flex justify-between border-t border-navy/10 pt-3 text-[16px] text-navy">
              <dt className="font-medium">Total</dt>
              <dd className="font-display text-xl">
                {shippingPending ? "—" : formatRM(total)}
              </dd>
            </div>
          </dl>

          {loyalty && pointsEarned > 0 && (
            <p className="mt-3 text-[12px] tracking-wide text-navy-400">
              Earns {pointsEarned} Kalima Club point{pointsEarned === 1 ? "" : "s"}
              {loyalty.multiplierBps > 10000 &&
                ` at ${(loyalty.multiplierBps / 10000).toFixed(1)}× ${loyalty.tierName}`}
              {" "}once your order is complete.
            </p>
          )}

          {error && (
            <p className="mt-4 border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</p>
          )}

          <Button variant="kalima" size="editorial" className="mt-5 w-full" onClick={submit} disabled={placing}>
            {placing ? "Placing order…" : "Place order"}
          </Button>
          <Link href="/" className="mt-3 block text-center text-[12px] text-navy-400 underline underline-offset-4 hover:text-navy">
            Continue shopping
          </Link>
        </aside>
      </div>
    </div>
  );
}
