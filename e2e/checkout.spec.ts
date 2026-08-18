import { expect, test, type Page } from "@playwright/test";
import { NEW_MEMBER, RETURNING_MEMBER } from "./fixtures";

/*
  The new-member discount, asserted on the page a customer actually sees.

  These rules were previously only ever proven by calling the Postgres functions
  directly. That says the database is right; it says nothing about whether the
  checkout renders what the database will charge — which is the failure this
  suite exists to catch, because it is invisible until a customer meets it.

  Each test asserts the DIFFERENCE the rule makes, not merely that a line of
  text exists: a discount that is displayed but not subtracted, or subtracted
  twice, would pass a text-only assertion and cost real money.
*/

const FIRST_ORDER_DISCOUNT = 10; // RM — the seeded signup_promo amount

async function signIn(page: Page, member: { email: string; password: string }) {
  await page.goto("/login");
  await page.fill('input[name="email"]', member.email);
  await page.fill('input[name="password"]', member.password);
  await page.click('button[type="submit"]');
  // Sign-in redirects away from /login; anything else means it failed.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
}

/*
  Fills the bag by writing the store's own persisted state.

  Deliberately not by clicking through a product page: what is under test is the
  checkout's arithmetic, and driving the catalogue UI would make these tests
  fail for reasons that have nothing to do with pricing — a renamed size, a
  sold-out colourway, a changed button label. The shape written here is
  CartItem from src/stores/cart.ts, and the key is its persist name.
*/
async function seedBag(page: Page) {
  const item = await page.evaluate(async () => {
    const res = await fetch("/api/products");
    const { products } = await res.json();

    /* The first variant with stock. Picking blind would eventually choose a
       sold-out colourway and fail the checkout for a reason unrelated to
       pricing — create_order refuses to place an order for one. */
    for (const p of products ?? []) {
      for (const [key, stock] of Object.entries(p.stockByVariant ?? {})) {
        if ((stock as number) <= 0) continue;
        const [color, size] = key.split("|");
        return {
          productId: p.id,
          slug: p.slug,
          name: p.name,
          price: p.price,
          color,
          size,
          tone: p.tone ?? "#cccccc",
          qty: 1,
        };
      }
    }
    return null;
  });

  expect(item, "no product variant with stock to test against").toBeTruthy();

  /* Written straight into the store's persisted state rather than clicked
     through the catalogue: what is under test is the checkout's arithmetic, and
     driving the product UI would make these fail for reasons that have nothing
     to do with pricing — a renamed size, a changed button label. The shape is
     CartItem from src/stores/cart.ts; the key is its persist name. */
  await page.evaluate((cartItem) => {
    window.localStorage.setItem(
      "kalima-cart",
      JSON.stringify({ state: { items: [cartItem] }, version: 0 }),
    );
  }, item);
}

/** The totals panel, read off the page as numbers. */
async function readSummary(page: Page) {
  const row = async (label: string): Promise<number | null> => {
    const dt = page.locator("dl dt", { hasText: label }).first();
    if ((await dt.count()) === 0) return null;
    const text = await dt.locator("xpath=following-sibling::dd[1]").innerText();
    const value = Number(text.replace(/[^\d.]/g, ""));
    return Number.isFinite(value) ? value : null;
  };

  return {
    subtotal: await row("Subtotal"),
    firstOrder: await row("Welcome"),
    shipping: await row("Shipping"),
    total: await row("Total"),
  };
}

test.describe("checkout — new-member discount", () => {
  test("a member who has never bought sees it, and it comes off the total", async ({ page }) => {
    await page.goto("/");
    await seedBag(page);
    await signIn(page, NEW_MEMBER);

    await page.goto("/checkout");
    await expect(page.getByText("Welcome — first order")).toBeVisible({ timeout: 20_000 });

    const s = await readSummary(page);
    expect(s.subtotal, "subtotal should be shown").toBeGreaterThan(0);
    expect(s.firstOrder).toBe(FIRST_ORDER_DISCOUNT);

    /* The arithmetic, not just the line: the discount has to actually leave the
       total, exactly once. */
    expect(s.total).toBeCloseTo(s.subtotal! + (s.shipping ?? 0) - FIRST_ORDER_DISCOUNT, 2);
  });

  test("a member who has already bought does not", async ({ page }) => {
    await page.goto("/");
    await seedBag(page);
    await signIn(page, RETURNING_MEMBER);

    await page.goto("/checkout");
    await expect(page.getByText("Subtotal")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Welcome — first order")).toHaveCount(0);

    const s = await readSummary(page);
    expect(s.total).toBeCloseTo(s.subtotal! + (s.shipping ?? 0), 2);
  });

  test("a guest does not", async ({ page }) => {
    await page.goto("/");
    await seedBag(page);

    await page.goto("/checkout");
    await expect(page.getByText("Subtotal")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Welcome — first order")).toHaveCount(0);
  });
});
