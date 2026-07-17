import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CartItem = {
  productId: string;
  slug: string;
  name: string;
  price: number;
  color: string;
  size: string;
  tone: string;
  image?: string;
  qty: number;
};

export const FREE_SHIPPING_THRESHOLD = 300; // RM — pending client confirmation (300 vs 500)

type CartState = {
  items: CartItem[];
  add: (item: Omit<CartItem, "qty">, qty?: number) => void;
  remove: (key: string) => void;
  setQty: (key: string, qty: number) => void;
  clear: () => void;
};

export const cartKey = (i: Pick<CartItem, "productId" | "color" | "size">) =>
  `${i.productId}|${i.color}|${i.size}`;

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      add: (item, qty = 1) =>
        set((s) => {
          const key = cartKey(item);
          const existing = s.items.find((i) => cartKey(i) === key);
          if (existing) {
            return {
              items: s.items.map((i) =>
                cartKey(i) === key ? { ...i, qty: i.qty + qty } : i,
              ),
            };
          }
          return { items: [...s.items, { ...item, qty }] };
        }),
      remove: (key) => set((s) => ({ items: s.items.filter((i) => cartKey(i) !== key) })),
      setQty: (key, qty) =>
        set((s) => ({
          items:
            qty <= 0
              ? s.items.filter((i) => cartKey(i) !== key)
              : s.items.map((i) => (cartKey(i) === key ? { ...i, qty } : i)),
        })),
      clear: () => set({ items: [] }),
    }),
    { name: "kalima-cart" },
  ),
);

export const cartCount = (items: CartItem[]) => items.reduce((n, i) => n + i.qty, 0);
export const cartSubtotal = (items: CartItem[]) =>
  items.reduce((n, i) => n + i.qty * i.price, 0);
