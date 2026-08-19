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
  /*
    Matched as a REGEX anchored at the start, not as a substring. Playwright's
    string `hasText` is a case-insensitive contains — so "Total" also matches
    "Subtotal", and every total read here was silently the subtotal. It went
    unnoticed because RM10 of shipping and RM10 of discount cancel out.
  */
  const row = async (label: RegExp): Promise<number | null> => {
    const dt = page.locator("dl dt").filter({ hasText: label }).first();
    if ((await dt.count()) === 0) return null;
    const text = await dt.locator("xpath=following-sibling::dd[1]").innerText();
    const value = Number(text.replace(/[^\d.]/g, ""));
    return Number.isFinite(value) ? value : null;
  };

  return {
    subtotal: await row(/^Subtotal$/),
    firstOrder: await row(/^Welcome/),
    shipping: await row(/^Shipping$/),
    total: await row(/^Total$/),
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

/*
  Overseas delivery.

  The thing worth defending here is not that a list appears — it is that the
  price on the summary is one the SERVER issued. So these assert the join: the
  figure printed beside a courier is the figure the total moves by, and until a
  courier is chosen there is no total at all.

  They run against live EasyParcel rates, so no amount is hardcoded; every
  assertion is a relationship between two numbers on the page.
*/
const OVERSEAS = {
  country: "Singapore",
  recipient: "E2E Buyer",
  line1: "1 Marina Boulevard",
  city: "Singapore",
  postcode: "018956",
  state: "Central",
  phone: "+6591234567",
};

async function chooseCountry(page: Page, name: string) {
  await page.locator("#co-country").click();
  await page.getByRole("option", { name, exact: true }).click();
}

async function fillOverseasAddress(page: Page) {
  await chooseCountry(page, OVERSEAS.country);
  await page.fill("#co-email", "overseas@kalima.test");
  await page.fill("#co-recipient", OVERSEAS.recipient);
  await page.fill("#co-line1", OVERSEAS.line1);
  await page.fill("#co-city", OVERSEAS.city);
  await page.fill("#co-postcode", OVERSEAS.postcode);
  await page.fill("#co-state", OVERSEAS.state);
  /* Filled last, and non-Malaysian on purpose: the ^01 rule has to have dropped
     with the country, or this address never reaches the courier guard. */
  await page.fill("#co-phone", OVERSEAS.phone);
}

/** The Shipping line, which is the one figure these tests are really about. */
function shippingCell(page: Page) {
  return page.locator("dl dt", { hasText: "Shipping" }).first()
    .locator("xpath=following-sibling::dd[1]");
}

test.describe("checkout — overseas delivery", () => {
  test("no courier chosen means no total to charge", async ({ page }) => {
    await page.goto("/");
    await seedBag(page);
    await page.goto("/checkout");
    await expect(page.getByText("Subtotal")).toBeVisible({ timeout: 20_000 });

    await fillOverseasAddress(page);

    /* Not "RM0". A zero here would read as free delivery beside a total that
       silently omitted it — the exact misstatement this shop does not make. */
    await expect(shippingCell(page)).toHaveText("Choose a courier", { timeout: 20_000 });

    await page.getByRole("button", { name: /place order/i }).click();
    await expect(page.getByText(/choose a delivery service/i)).toBeVisible();
  });

  test("the courier's price is the price charged", async ({ page }) => {
    await page.goto("/");
    await seedBag(page);
    await page.goto("/checkout");
    await expect(page.getByText("Subtotal")).toBeVisible({ timeout: 20_000 });

    await fillOverseasAddress(page);
    await page.getByRole("button", { name: /get delivery options/i }).click();

    const couriers = page.locator('input[type="radio"]');
    await expect(couriers.first()).toBeVisible({ timeout: 60_000 });

    /* Whatever the second-cheapest happens to be today. Picking a named courier
       would make this fail when EasyParcel's line-up changes, which is not the
       thing under test. */
    const row = couriers.nth(1).locator("xpath=ancestor::label[1]");
    const quoted = Number((await row.innerText()).match(/RM\s*([\d.,]+)/)![1].replace(/,/g, ""));
    await couriers.nth(1).check();

    await expect(shippingCell(page)).toContainText("RM", { timeout: 20_000 });

    const s = await readSummary(page);
    expect(s.shipping).toBeCloseTo(quoted, 2);
    expect(s.total).toBeCloseTo(s.subtotal! + quoted - (s.firstOrder ?? 0), 2);
  });

  test("Malaysia stays flat, and asks for no courier", async ({ page }) => {
    await page.goto("/");
    await seedBag(page);
    await page.goto("/checkout");
    await expect(page.getByText("Subtotal")).toBeVisible({ timeout: 20_000 });

    /* The default. A country selector that quietly changed the domestic price
       would be the worst way to learn this feature shipped. */
    await expect(page.locator("#co-country")).toHaveText("Malaysia");
    await expect(page.getByRole("button", { name: /get delivery options/i })).toHaveCount(0);

    /* Waited for, not read at once: the first render shows the goods total
       until the server's quote lands, and asserting into that gap would test
       the loading state rather than the price. */
    await expect(shippingCell(page)).toHaveText(/RM\s*[1-9]/, { timeout: 20_000 });

    const s = await readSummary(page);
    expect(s.total).toBeCloseTo(s.subtotal! + s.shipping! - (s.firstOrder ?? 0), 2);
  });
});
