"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCart,
  cartKey,
  cartSubtotal,
  FREE_SHIPPING_THRESHOLD,
} from "@/stores/cart";
import { useUi } from "@/stores/ui";
import { useMounted } from "@/hooks/useMounted";
import { formatRM } from "@/lib/format";
import { CloseIcon, MinusIcon, PlusIcon } from "@/components/brand/Icons";
import ProductImage from "@/components/brand/ProductImage";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";

/*
  Slide-over shopping bag, built on the shadcn Sheet (Radix Dialog). The
  primitive owns the backdrop, focus trap, Escape handling, body scroll lock
  and the slide animation; everything below is Kalima chrome.
*/
export default function CartDrawer() {
  const { cartOpen, setCartOpen } = useUi();
  const { items, setQty, remove } = useCart();
  const router = useRouter();

  // The cart is persisted to localStorage — hold the empty state until mount.
  const mounted = useMounted();
  const cartItems = mounted ? items : [];

  const subtotal = cartSubtotal(cartItems);
  const remaining = Math.max(0, FREE_SHIPPING_THRESHOLD - subtotal);
  const progress = Math.min(100, (subtotal / FREE_SHIPPING_THRESHOLD) * 100);

  return (
    <Sheet open={cartOpen} onOpenChange={setCartOpen}>
      <SheetContent
        side="right"
        showCloseButton={false}
        aria-describedby={undefined}
        className="flex w-full max-w-md flex-col gap-0 border-l-0 bg-cream-50 p-0 shadow-2xl sm:max-w-md"
      >
        <div className="flex items-center justify-between border-b border-navy/10 px-6 py-5">
          <SheetTitle className="label-caps !text-[13px] font-medium text-navy">
            Your Bag
          </SheetTitle>
          <SheetClose
            aria-label="Close bag"
            className="text-navy-400 hover:text-navy cursor-pointer"
          >
            <CloseIcon size={18} />
          </SheetClose>
        </div>

        <div className="border-b border-navy/10 px-6 py-4">
          <p className="text-[12px] tracking-wide text-navy-400">
            {remaining > 0 ? (
              <>
                You&apos;re{" "}
                <span className="text-navy font-medium">{formatRM(remaining)}</span>{" "}
                away from free shipping
              </>
            ) : (
              <span className="text-navy font-medium">
                You&apos;ve unlocked free shipping ✨
              </span>
            )}
          </p>
          <Progress
            value={progress}
            aria-label="Progress towards free shipping"
            className="mt-2 h-1 w-full rounded-none bg-navy-100 [&>*]:bg-navy [&>*]:duration-500"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-6">
          {cartItems.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
              <p className="font-display text-xl text-navy">Your bag is empty</p>
              <Button
                variant="kalimaOutline"
                size="editorial"
                onClick={() => setCartOpen(false)}
              >
                Continue Shopping
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-navy/10">
              {cartItems.map((item) => {
                const key = cartKey(item);
                return (
                  <li key={key} className="flex gap-4 py-5">
                    <Link
                      href={`/products/${item.slug}`}
                      onClick={() => setCartOpen(false)}
                      className="shrink-0"
                    >
                      <ProductImage
                        image={item.image}
                        tone={item.tone}
                        alt={item.name}
                        className="h-24 w-20"
                        sizes="80px"
                      />
                    </Link>
                    <div className="flex flex-1 flex-col">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <Link
                            href={`/products/${item.slug}`}
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

        {cartItems.length > 0 && (
          <div className="border-t border-navy/10 px-6 py-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="label-caps">Subtotal</span>
              <span className="font-display text-xl">{formatRM(subtotal)}</span>
            </div>
            <Button
              variant="kalima"
              size="editorial"
              className="w-full"
              onClick={() => {
                setCartOpen(false);
                router.push("/checkout");
              }}
            >
              Secure Checkout
            </Button>
            <p className="mt-3 text-center text-[11px] tracking-wide text-navy-300">
              Shipping &amp; taxes calculated at checkout
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
