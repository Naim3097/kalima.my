import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCart, cartSubtotal, FREE_SHIPPING_THRESHOLD } from "../stores/cart";
import { COURIER_QUOTES } from "../data/demo";
import { formatRM } from "../lib/format";
import ProductImage from "../components/ui/ProductImage";
import Button from "../components/ui/Button";

const MY_STATES = ["Selangor", "Kuala Lumpur", "Johor", "Penang", "Perak", "Kedah", "Kelantan", "Terengganu", "Pahang", "Negeri Sembilan", "Melaka", "Perlis", "Sabah", "Sarawak", "Putrajaya", "Labuan"];

const PAYMENT_METHODS = [
  { id: "fpx", label: "FPX Online Banking", note: "Maybank2u · CIMB Clicks · Bank Islam · +12 banks" },
  { id: "card", label: "Credit / Debit Card", note: "Visa · Mastercard" },
  { id: "ewallet", label: "E-Wallet", note: "GrabPay · Touch 'n Go · ShopeePay" },
];

export default function CheckoutPage() {
  const { items } = useCart();
  const navigate = useNavigate();
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

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24 text-center">
        <h1 className="font-display text-3xl text-navy">Your bag is empty</h1>
        <div className="mt-8">
          <Button to="/collections/best-sellers">Shop Best Sellers</Button>
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
            <h2 className="label-caps mb-4 !text-[13px]">1 · Contact & Delivery</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <input placeholder="Full name" className="border border-navy/20 bg-white px-4 py-3 text-[14px] text-navy placeholder:text-navy-300 focus:border-navy focus:outline-none" defaultValue="Nurul Aisyah" />
              <input placeholder="WhatsApp number" className="border border-navy/20 bg-white px-4 py-3 text-[14px] text-navy placeholder:text-navy-300 focus:border-navy focus:outline-none" defaultValue="+60 12-345 6789" />
              <input placeholder="Address line" className="border border-navy/20 bg-white px-4 py-3 text-[14px] text-navy placeholder:text-navy-300 focus:border-navy focus:outline-none sm:col-span-2" defaultValue="12, Jalan Setia 3/2" />
              <input placeholder="Postcode" className="border border-navy/20 bg-white px-4 py-3 text-[14px] text-navy placeholder:text-navy-300 focus:border-navy focus:outline-none" defaultValue="40170" />
              <select className="border border-navy/20 bg-white px-4 py-3 text-[14px] text-navy focus:border-navy focus:outline-none" defaultValue="Selangor">
                {MY_STATES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            <label className="mt-3 flex items-center gap-2.5 text-[12px] tracking-wide text-navy-400">
              <input type="checkbox" defaultChecked className="accent-navy" />
              Send my order updates via WhatsApp, and keep me on the Kalima Club list (PDPA consent)
            </label>
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
                <ProductImage image={i.image} tone={i.tone} alt={i.name} className="h-20 w-16 shrink-0" />
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
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Discount / affiliate code"
              className="flex-1 border border-navy/20 bg-cream-50 px-3 py-2.5 text-[13px] text-navy placeholder:text-navy-300 focus:border-navy focus:outline-none"
            />
            <button
              onClick={() => code.trim() && setAppliedCode(code.trim())}
              className="label-caps border border-navy/30 px-4 text-navy hover:border-navy transition-colors cursor-pointer"
            >
              Apply
            </button>
          </div>
          {appliedCode && (
            <p className="mt-2 text-[12px] tracking-wide text-emerald-700">
              ✓ {appliedCode} applied — 10% off{appliedCode.startsWith("AISYAH") && " · supporting @aisyahstyles"}
            </p>
          )}

          {/* Points */}
          <label className="mt-4 flex items-center justify-between border border-navy/10 bg-cream-50 px-4 py-3 text-[13px] cursor-pointer">
            <span className="flex items-center gap-2.5">
              <input type="checkbox" checked={usePoints} onChange={(e) => setUsePoints(e.target.checked)} className="accent-navy" />
              <span className="text-navy">Redeem 1,000 Kalima Club points</span>
            </span>
            <span className="text-navy">−RM50</span>
          </label>

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

          <p className="mt-3 text-[12px] tracking-wide text-navy-300">You'll earn {Math.floor(total)} Club points with this order</p>

          <Button className="mt-5 w-full" onClick={() => navigate("/checkout/success")}>
            Place Order — Demo
          </Button>
          <p className="mt-3 text-center text-[11px] tracking-wide text-navy-300">
            Live FPX/card payment via gateway webhook arrives in Phase 2
          </p>
          <Link to="/" className="mt-2 block text-center text-[12px] text-navy-400 underline underline-offset-4 hover:text-navy">
            Continue shopping
          </Link>
        </aside>
      </div>
    </div>
  );
}
