import { Link, useNavigate } from "react-router-dom";
import { useCart, cartKey, cartSubtotal, FREE_SHIPPING_THRESHOLD } from "../../stores/cart";
import { useUi } from "../../stores/ui";
import { formatRM } from "../../lib/format";
import { CloseIcon, MinusIcon, PlusIcon } from "../ui/Icons";
import ProductImage from "../ui/ProductImage";
import Button from "../ui/Button";

export default function CartDrawer() {
  const { cartOpen, setCartOpen } = useUi();
  const { items, setQty, remove } = useCart();
  const navigate = useNavigate();
  const subtotal = cartSubtotal(items);
  const remaining = Math.max(0, FREE_SHIPPING_THRESHOLD - subtotal);
  const progress = Math.min(100, (subtotal / FREE_SHIPPING_THRESHOLD) * 100);

  return (
    <>
      <div
        className={`fixed inset-0 z-50 bg-navy-900/40 transition-opacity ${
          cartOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setCartOpen(false)}
        aria-hidden
      />
      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-cream-50 shadow-2xl transition-transform duration-300 ${
          cartOpen ? "translate-x-0" : "translate-x-full"
        }`}
        aria-label="Shopping bag"
      >
        <div className="flex items-center justify-between border-b border-navy/10 px-6 py-5">
          <h2 className="label-caps !text-[13px]">Your Bag</h2>
          <button onClick={() => setCartOpen(false)} aria-label="Close bag" className="text-navy-400 hover:text-navy cursor-pointer">
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="border-b border-navy/10 px-6 py-4">
          <p className="text-[12px] tracking-wide text-navy-400">
            {remaining > 0 ? (
              <>
                You're <span className="text-navy font-medium">{formatRM(remaining)}</span> away from free shipping
              </>
            ) : (
              <span className="text-navy font-medium">You've unlocked free shipping ✨</span>
            )}
          </p>
          <div className="mt-2 h-1 w-full bg-navy-100">
            <div className="h-1 bg-navy transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6">
          {items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
              <p className="font-display text-xl text-navy">Your bag is empty</p>
              <Button variant="outline" onClick={() => setCartOpen(false)}>
                Continue Shopping
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-navy/10">
              {items.map((item) => {
                const key = cartKey(item);
                return (
                  <li key={key} className="flex gap-4 py-5">
                    <Link to={`/products/${item.slug}`} onClick={() => setCartOpen(false)} className="shrink-0">
                      <ProductImage image={item.image} tone={item.tone} alt={item.name} className="h-24 w-20" />
                    </Link>
                    <div className="flex flex-1 flex-col">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <Link
                            to={`/products/${item.slug}`}
                            onClick={() => setCartOpen(false)}
                            className="text-[14px] hover:underline underline-offset-4"
                          >
                            {item.name}
                          </Link>
                          <p className="mt-0.5 text-[12px] text-navy-400">
                            {item.color} · {item.size}
                          </p>
                        </div>
                        <button
                          onClick={() => remove(key)}
                          aria-label="Remove item"
                          className="text-navy-300 hover:text-navy cursor-pointer"
                        >
                          <CloseIcon size={14} />
                        </button>
                      </div>
                      <div className="mt-auto flex items-center justify-between">
                        <div className="flex items-center border border-navy/20">
                          <button
                            onClick={() => setQty(key, item.qty - 1)}
                            className="px-2.5 py-1.5 text-navy-400 hover:text-navy cursor-pointer"
                            aria-label="Decrease quantity"
                          >
                            <MinusIcon size={12} />
                          </button>
                          <span className="w-7 text-center text-[13px]">{item.qty}</span>
                          <button
                            onClick={() => setQty(key, item.qty + 1)}
                            className="px-2.5 py-1.5 text-navy-400 hover:text-navy cursor-pointer"
                            aria-label="Increase quantity"
                          >
                            <PlusIcon size={12} />
                          </button>
                        </div>
                        <span className="text-[14px]">{formatRM(item.price * item.qty)}</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-navy/10 px-6 py-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="label-caps">Subtotal</span>
              <span className="font-display text-xl">{formatRM(subtotal)}</span>
            </div>
            <Button
              className="w-full"
              onClick={() => {
                setCartOpen(false);
                navigate("/checkout");
              }}
            >
              Secure Checkout
            </Button>
            <p className="mt-3 text-center text-[11px] tracking-wide text-navy-300">
              Shipping & taxes calculated at checkout
            </p>
          </div>
        )}
      </aside>
    </>
  );
}
