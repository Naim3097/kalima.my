"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart, cartSubtotal, FREE_SHIPPING_THRESHOLD } from "@/stores/cart";
import { COURIER_QUOTES } from "@/data/demo";
import { formatRM } from "@/lib/format";
import { useMounted } from "@/hooks/useMounted";
import ProductImage from "@/components/brand/ProductImage";
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

const MY_STATES = ["Selangor", "Kuala Lumpur", "Johor", "Penang", "Perak", "Kedah", "Kelantan", "Terengganu", "Pahang", "Negeri Sembilan", "Melaka", "Perlis", "Sabah", "Sarawak", "Putrajaya", "Labuan"];

const PAYMENT_METHODS = [
  { id: "fpx", label: "FPX Online Banking", note: "Maybank2u · CIMB Clicks · Bank Islam · +12 banks" },
  { id: "card", label: "Credit / Debit Card", note: "Visa · Mastercard" },
  { id: "ewallet", label: "E-Wallet", note: "GrabPay · Touch 'n Go · ShopeePay" },
];

/* Editorial field skin — flat, square, cream-on-white, navy focus ring-free. */
const fieldClass =
  "h-auto rounded-none border-navy/20 bg-white px-4 py-3 text-[14px] md:text-[14px] text-navy shadow-none placeholder:text-navy-300 focus-visible:border-navy focus-visible:ring-0";

export default function CheckoutForm() {
  const mounted = useMounted();
  const { items } = useCart();
  const router = useRouter();
  const subtotal = cartSubtotal(items);
  const freeShipping = subtotal >= FREE_SHIPPING_THRESHOLD;

  const [courier, setCourier] = useState(0);
  const [payment, setPayment] = useState("fpx");
  const [code, setCode] = useState("");
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [usePoints, setUsePoints] = useState(false);

  const discount = appliedCode ? Math.round(subtotal * 0.1) : 0;
  const pointsValue = usePoints ? 50 : 0; // demo: 1,000 pts = RM50
  const shipping = freeShipping ? 0 : COURIER_QUOTES[courier].price;
  const total = Math.max(0, subtotal - discount - pointsValue + shipping);

  // The cart is persisted to localStorage — render the empty state until mounted.
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
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-display text-4xl text-navy">Checkout</h1>
        <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-[11px] uppercase tracking-wider text-amber-900">
          Demo preview — Phase 2
        </span>
      </div>

      <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr]">
        {/* Left: form */}
        <div className="space-y-8">
          <section>
            <h2 className="label-caps mb-4 !text-[13px]">1 · Contact &amp; Delivery</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="checkout-name" className="sr-only">
                  Full name
                </Label>
                <Input id="checkout-name" placeholder="Full name" className={fieldClass} defaultValue="Nurul Aisyah" />
              </div>
              <div>
                <Label htmlFor="checkout-whatsapp" className="sr-only">
                  WhatsApp number
                </Label>
                <Input id="checkout-whatsapp" placeholder="WhatsApp number" className={fieldClass} defaultValue="+60 12-345 6789" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="checkout-address" className="sr-only">
                  Address line
                </Label>
                <Input id="checkout-address" placeholder="Address line" className={fieldClass} defaultValue="12, Jalan Setia 3/2" />
              </div>
              <div>
                <Label htmlFor="checkout-postcode" className="sr-only">
                  Postcode
                </Label>
                <Input id="checkout-postcode" placeholder="Postcode" className={fieldClass} defaultValue="40170" />
              </div>
              <div>
                <Label htmlFor="checkout-state" className="sr-only">
                  State
                </Label>
                <Select defaultValue="Selangor">
                  <SelectTrigger
                    id="checkout-state"
                    className="w-full rounded-none border-navy/20 bg-white px-4 py-3 text-[14px] text-navy shadow-none focus-visible:border-navy focus-visible:ring-0 data-[size=default]:h-auto"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MY_STATES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Label
              htmlFor="checkout-pdpa"
              className="mt-3 flex items-center gap-2.5 text-[12px] leading-normal font-normal tracking-wide text-navy-400"
            >
              <Checkbox
                id="checkout-pdpa"
                defaultChecked
                className="border-navy/40 data-[state=checked]:border-navy data-[state=checked]:bg-navy"
              />
              Send my order updates via WhatsApp, and keep me on the Kalima Club list (PDPA consent)
            </Label>
          </section>

          <section>
            <h2 className="label-caps mb-1 !text-[13px]">2 · Shipping</h2>
            <p className="mb-4 text-[12px] tracking-wide text-navy-300">
              Live rates by EasyParcel{freeShipping && " — free shipping unlocked, on us 🤍"}
            </p>
            <div className="space-y-2">
              {COURIER_QUOTES.map((q, i) => (
                <label
                  key={q.courier}
                  className={`flex cursor-pointer items-center justify-between border px-4 py-3.5 text-[14px] transition-colors ${
                    courier === i ? "border-navy bg-navy-100/40" : "border-navy/15 hover:border-navy/40"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <input type="radio" name="courier" checked={courier === i} onChange={() => setCourier(i)} className="accent-navy" />
                    <span className="text-navy">{q.courier}</span>
                    <span className="text-[12px] text-navy-400">{q.eta}</span>
                  </span>
                  <span className="text-navy">{freeShipping ? <s className="text-navy-300">{formatRM(q.price)}</s> : formatRM(q.price)}</span>
                </label>
              ))}
            </div>
          </section>

          <section>
            <h2 className="label-caps mb-4 !text-[13px]">3 · Payment</h2>
            <div className="space-y-2">
              {PAYMENT_METHODS.map((m) => (
                <label
                  key={m.id}
                  className={`flex cursor-pointer items-center justify-between border px-4 py-3.5 text-[14px] transition-colors ${
                    payment === m.id ? "border-navy bg-navy-100/40" : "border-navy/15 hover:border-navy/40"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <input type="radio" name="payment" checked={payment === m.id} onChange={() => setPayment(m.id)} className="accent-navy" />
                    <span className="text-navy">{m.label}</span>
                  </span>
                  <span className="text-[12px] text-navy-400">{m.note}</span>
                </label>
              ))}
            </div>
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
                  <p className="mt-0.5 text-navy-400">
                    {i.color} · {i.size} × {i.qty}
                  </p>
                </div>
                <span className="text-[13px] text-navy">{formatRM(i.price * i.qty)}</span>
              </li>
            ))}
          </ul>

          {/* Discount / affiliate code */}
          <div className="mt-4 flex gap-2">
            <Label htmlFor="checkout-code" className="sr-only">
              Discount / affiliate code
            </Label>
            <Input
              id="checkout-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Discount / affiliate code"
              className="h-auto flex-1 rounded-none border-navy/20 bg-cream-50 px-3 py-2.5 text-[13px] text-navy shadow-none placeholder:text-navy-300 focus-visible:border-navy focus-visible:ring-0 md:text-[13px]"
            />
            <Button
              variant="kalimaOutline"
              size="editorial"
              onClick={() => code.trim() && setAppliedCode(code.trim())}
              className="border-navy/30 px-4 py-0 hover:border-navy"
            >
              Apply
            </Button>
          </div>
          {appliedCode && (
            <p className="mt-2 text-[12px] tracking-wide text-emerald-700">
              ✓ {appliedCode} applied — 10% off{appliedCode.startsWith("AISYAH") && " · supporting @aisyahstyles"}
            </p>
          )}

          {/* Points */}
          <Label
            htmlFor="checkout-points"
            className="mt-4 flex cursor-pointer items-center justify-between gap-0 border border-navy/10 bg-cream-50 px-4 py-3 text-[13px] leading-normal font-normal"
          >
            <span className="flex items-center gap-2.5">
              <Checkbox
                id="checkout-points"
                checked={usePoints}
                onCheckedChange={(v) => setUsePoints(v === true)}
                className="border-navy/40 data-[state=checked]:border-navy data-[state=checked]:bg-navy"
              />
              <span className="text-navy">Redeem 1,000 Kalima Club points</span>
            </span>
            <span className="text-navy">−RM50</span>
          </Label>

          <dl className="mt-5 space-y-2 border-t border-navy/10 pt-4 text-[13px]">
            <div className="flex justify-between text-navy-400">
              <dt>Subtotal</dt>
              <dd>{formatRM(subtotal)}</dd>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-emerald-700">
                <dt>Code {appliedCode}</dt>
                <dd>−{formatRM(discount)}</dd>
              </div>
            )}
            {pointsValue > 0 && (
              <div className="flex justify-between text-emerald-700">
                <dt>Club points</dt>
                <dd>−{formatRM(pointsValue)}</dd>
              </div>
            )}
            <div className="flex justify-between text-navy-400">
              <dt>Shipping — {COURIER_QUOTES[courier].courier}</dt>
              <dd>{freeShipping ? "FREE" : formatRM(shipping)}</dd>
            </div>
            <div className="flex justify-between border-t border-navy/10 pt-3 text-[16px] text-navy">
              <dt className="font-medium">Total</dt>
              <dd className="font-display text-xl">{formatRM(total)}</dd>
            </div>
          </dl>

          <p className="mt-3 text-[12px] tracking-wide text-navy-300">You&apos;ll earn {Math.floor(total)} Club points with this order</p>

          <Button
            variant="kalima"
            size="editorial"
            className="mt-5 w-full"
            onClick={() => router.push("/checkout/success")}
          >
            Place Order — Demo
          </Button>
          <p className="mt-3 text-center text-[11px] tracking-wide text-navy-300">
            Live FPX/card payment via gateway webhook arrives in Phase 2
          </p>
          <Link href="/" className="mt-2 block text-center text-[12px] text-navy-400 underline underline-offset-4 hover:text-navy">
            Continue shopping
          </Link>
        </aside>
      </div>
    </div>
  );
}
