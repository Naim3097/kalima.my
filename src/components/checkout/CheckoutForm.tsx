"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useCart, cartSubtotal, FREE_SHIPPING_THRESHOLD } from "@/stores/cart";
import { formatRM } from "@/lib/format";
import { useMounted } from "@/hooks/useMounted";
import { placeOrder, checkDiscount } from "@/app/checkout/actions";
import type { CartRef } from "@/lib/commerce";
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

const FLAT_SHIPPING = 10; // RM — placeholder until EasyParcel live rates (Phase 4)

const fieldClass =
  "h-auto rounded-none border-navy/20 bg-white px-4 py-3 text-[14px] md:text-[14px] text-navy shadow-none placeholder:text-navy-300 focus-visible:border-navy focus-visible:ring-0";

type Props = { defaultEmail?: string; defaultName?: string; defaultPhone?: string };

export default function CheckoutForm({ defaultEmail = "", defaultName = "", defaultPhone = "" }: Props) {
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
  });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

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

  const discountRM = discount ? discount.discountSen / 100 : 0;
  const freeShipping = subtotal - discountRM >= FREE_SHIPPING_THRESHOLD || !!discount?.freeShipping;
  const shipping = freeShipping ? 0 : FLAT_SHIPPING;
  const total = Math.max(0, subtotal - discountRM + shipping);

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
    startPlace(async () => {
      const result = await placeOrder(cartRefs, {
        ...form,
        shippingMethod: freeShipping ? "Standard (free)" : "Standard",
        discountCode: discount?.code ?? "",
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
                  value={form.email} onChange={(e) => set("email")(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="co-phone" className="sr-only">Phone</Label>
                <Input id="co-phone" type="tel" placeholder="Phone / WhatsApp number" className={fieldClass}
                  value={form.phone} onChange={(e) => set("phone")(e.target.value)} />
              </div>
            </div>
          </section>

          <section>
            <h2 className="label-caps mb-4 !text-[13px]">2 · Delivery</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="co-recipient" className="sr-only">Recipient name</Label>
                <Input id="co-recipient" placeholder="Recipient full name" className={fieldClass}
                  value={form.recipient} onChange={(e) => set("recipient")(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="co-line1" className="sr-only">Address line 1</Label>
                <Input id="co-line1" placeholder="Address line 1" className={fieldClass}
                  value={form.line1} onChange={(e) => set("line1")(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="co-line2" className="sr-only">Address line 2</Label>
                <Input id="co-line2" placeholder="Address line 2 (optional)" className={fieldClass}
                  value={form.line2} onChange={(e) => set("line2")(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="co-city" className="sr-only">City</Label>
                <Input id="co-city" placeholder="City" className={fieldClass}
                  value={form.city} onChange={(e) => set("city")(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="co-postcode" className="sr-only">Postcode</Label>
                <Input id="co-postcode" inputMode="numeric" placeholder="Postcode" className={fieldClass}
                  value={form.postcode} onChange={(e) => set("postcode")(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="co-state" className="sr-only">State</Label>
                <Select value={form.state} onValueChange={set("state")}>
                  <SelectTrigger id="co-state"
                    className="w-full rounded-none border-navy/20 bg-white px-4 py-3 text-[14px] text-navy shadow-none focus-visible:border-navy focus-visible:ring-0 data-[size=default]:h-auto">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MY_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="mt-3 text-[12px] tracking-wide text-navy-300">
              Standard delivery {formatRM(FLAT_SHIPPING)} — free over {formatRM(FREE_SHIPPING_THRESHOLD)}.
              Live courier rates arrive with EasyParcel.
            </p>
          </section>

          <section>
            <h2 className="label-caps mb-2 !text-[13px]">3 · Payment</h2>
            <p className="border border-navy/15 bg-cream-50 px-4 py-3 text-[13px] leading-relaxed text-navy-400">
              You&apos;ll be taken to our secure payment page to complete payment (FPX, card
              or e-wallet). Your order is reserved as soon as you place it.
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

          <dl className="mt-5 space-y-2 border-t border-navy/10 pt-4 text-[13px]">
            <div className="flex justify-between text-navy-400">
              <dt>Subtotal</dt><dd>{formatRM(subtotal)}</dd>
            </div>
            {discountRM > 0 && (
              <div className="flex justify-between text-emerald-700">
                <dt>Code {discount?.code}</dt><dd>−{formatRM(discountRM)}</dd>
              </div>
            )}
            <div className="flex justify-between text-navy-400">
              <dt>Shipping</dt><dd>{freeShipping ? "FREE" : formatRM(shipping)}</dd>
            </div>
            <div className="flex justify-between border-t border-navy/10 pt-3 text-[16px] text-navy">
              <dt className="font-medium">Total</dt>
              <dd className="font-display text-xl">{formatRM(total)}</dd>
            </div>
          </dl>

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
