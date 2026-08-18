/*
  The seeded members these tests run as, and the tools to make and unmake them.

  WHY PLAIN fetch AND NOT supabase-js: the client constructs a Realtime
  connection on creation, which needs a global WebSocket — absent on Node 20,
  which is what this project runs. Nothing here subscribes to anything, so the
  REST and auth-admin endpoints are both sufficient and one less thing between
  the fixture and the database.

  WHY SEEDED THROUGH THE ADMIN API rather than the sign-up form: staging has
  email confirmation on (`mailer_autoconfirm` is false), so a UI sign-up would
  sit unconfirmed forever waiting for an inbox no test can read. The admin API
  creates the account already confirmed; the tests then sign in through the real
  form, which is the part worth exercising.

  Every address is under @kalima.test — a reserved TLD that cannot receive mail
  and cannot collide with a real customer. Teardown deletes by that suffix, so
  the rule when adding fixtures is simply: keep the domain.
*/

export const NEW_MEMBER = {
  email: "e2e-new@kalima.test",
  password: "e2e-Password-123",
} as const;

export const RETURNING_MEMBER = {
  email: "e2e-returning@kalima.test",
  password: "e2e-Password-123",
} as const;

export const FIXTURE_EMAIL_SUFFIX = "@kalima.test";

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "e2e needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — the npm script loads .env.local with node --env-file.",
    );
  }
  return { url, key };
}

async function api(path: string, init: RequestInit = {}): Promise<unknown> {
  const { url, key } = env();
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** Creates (or re-creates) a confirmed account and returns its user id. */
export async function seedMember(member: { email: string; password: string }): Promise<string> {
  await deleteMember(member.email);

  const created = (await api("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: member.email,
      password: member.password,
      email_confirm: true,
    }),
  })) as { id?: string };

  if (!created?.id) throw new Error(`seedMember: no id returned for ${member.email}`);
  return created.id;
}

/*
  Gives a member one completed purchase, which is what makes them ineligible for
  the new-member discount.

  Placed through create_order rather than inserted, so the fixture goes through
  the same function the shop does — a hand-built row could disagree with what
  the code would actually have written, and then the test would be asserting
  against a fiction.
*/
export async function seedPaidOrder(userId: string, email: string): Promise<void> {
  const variants = (await api(
    "/rest/v1/product_variants?select=id&stock_on_hand=gt.5&limit=1",
  )) as { id: string }[];
  if (!variants?.length) throw new Error("seedPaidOrder: no variant with stock available");

  const placed = (await api("/rest/v1/rpc/create_order", {
    method: "POST",
    body: JSON.stringify({
      p_user_id: userId,
      p_items: [{ variant_id: variants[0].id, qty: 1 }],
      p_email: email,
      p_phone: "0123456789",
      p_address: {
        recipient: "E2E",
        line1: "1 Jalan Test",
        city: "Kuala Lumpur",
        postcode: "50000",
        state: "Kuala Lumpur",
        country: "MY",
      },
      p_shipping_method: "standard",
    }),
  })) as { reference: string };

  await api(`/rest/v1/orders?reference=eq.${placed.reference}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "paid", paid_at: new Date().toISOString() }),
  });
}

export async function deleteMember(email: string): Promise<void> {
  /* The admin list is paged; the fixtures live on page one of a staging project
     with a handful of accounts, and asking for more would outlive its use. */
  const listed = (await api("/auth/v1/admin/users?per_page=200")) as {
    users?: { id: string; email?: string }[];
  };
  const existing = listed?.users?.find((u) => u.email === email);
  if (existing) {
    await api(`/auth/v1/admin/users/${existing.id}`, { method: "DELETE" });
  }
}

/** Removes every order these tests placed, by fixture address. */
export async function deleteFixtureOrders(): Promise<number> {
  const orders = (await api(
    `/rest/v1/orders?select=id&email=like.*${FIXTURE_EMAIL_SUFFIX}`,
  )) as { id: string }[];

  if (!orders?.length) return 0;
  const ids = `(${orders.map((o) => o.id).join(",")})`;

  /* Children first — order_items and payments both reference orders, and the
     loyalty ledger records any points a fixture order burned. */
  for (const table of ["order_items", "payments", "loyalty_ledger"]) {
    await api(`/rest/v1/${table}?order_id=in.${ids}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  }
  await api(`/rest/v1/orders?id=in.${ids}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });

  return orders.length;
}
