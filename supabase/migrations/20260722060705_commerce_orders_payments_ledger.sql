/*
  Phase 2 — commerce core: orders, items, payments, the stock ledger,
  discounts, and the address book. PROJECT_PLAN.md §5 + §4.2.

  Money integrity (§4.2):
  - all money is integer *sen*, never float
  - order/payment prices are SNAPSHOTS taken server-side at creation — the
    catalog can change later without rewriting history
  - stock lives only on product_variants.stock_on_hand; every change is an
    auditable row in stock_movements
  - an order becomes 'paid' ONLY through mark_order_paid (called by a verified
    webhook), which is idempotent and oversell-guarded

  Callable entry points are SECURITY DEFINER functions:
  - create_order / validate_discount / get_order_by_reference — reachable by
    anon (guest checkout) + authenticated; the function IS the security
    boundary (prices computed server-side, never trusted from input)
  - mark_order_paid — service_role only (webhook); never anon/authenticated
*/

create type order_status   as enum ('pending', 'paid', 'fulfilled', 'completed', 'cancelled', 'refunded');
create type payment_status as enum ('pending', 'processing', 'paid', 'failed', 'refunded');
create type stock_movement_type as enum ('sale', 'restock', 'adjustment', 'release', 'marketplace_sync');

-- Human-friendly order refs continue the demo's KLM-1024x series.
create sequence order_reference_seq start 10250;

-- ---------------------------------------------------------------------------
-- Address book (saved addresses for signed-in users; guests snapshot onto the
-- order instead). West/East MY matters for shipping (Phase 4).
-- ---------------------------------------------------------------------------
create table addresses (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  recipient  text not null,
  phone      text,
  line1      text not null,
  line2      text,
  city       text not null,
  postcode   text not null,
  state      text not null,
  country    text not null default 'MY',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index addresses_user_idx on addresses (user_id);
alter table addresses enable row level security;
create trigger addresses_updated_at before update on addresses
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create table orders (
  id               uuid primary key default uuid_generate_v4(),
  reference        text not null unique default ('KLM-' || nextval('order_reference_seq')),
  -- Null for guest checkout; set when a signed-in customer orders.
  user_id          uuid references auth.users (id) on delete set null,
  email            text not null,
  phone            text,
  status           order_status not null default 'pending',
  currency         text not null default 'MYR',
  subtotal_sen     integer not null check (subtotal_sen >= 0),
  discount_sen     integer not null default 0 check (discount_sen >= 0),
  shipping_sen     integer not null default 0 check (shipping_sen >= 0),
  total_sen        integer not null check (total_sen >= 0),
  discount_code    text,
  shipping_method  text,
  shipping_address jsonb,   -- immutable snapshot of where it shipped
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  paid_at          timestamptz,
  cancelled_at     timestamptz
);
create index orders_user_idx on orders (user_id) where user_id is not null;
create index orders_status_idx on orders (status);
create index orders_reference_idx on orders (reference);
alter table orders enable row level security;
create trigger orders_updated_at before update on orders
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Order items — every price/label snapshotted so history survives catalog edits
-- ---------------------------------------------------------------------------
create table order_items (
  id                 uuid primary key default uuid_generate_v4(),
  order_id           uuid not null references orders (id) on delete cascade,
  -- Kept for stock decrement + reorder; restricted so a variant in an order
  -- can't be hard-deleted out from under it.
  product_variant_id uuid not null references product_variants (id) on delete restrict,
  product_name       text not null,
  variant_sku        text not null,
  color_name         text not null,
  size               text not null,
  unit_price_sen     integer not null check (unit_price_sen >= 0),
  qty                integer not null check (qty > 0),
  line_total_sen     integer not null check (line_total_sen >= 0)
);
create index order_items_order_idx on order_items (order_id);
alter table order_items enable row level security;

-- ---------------------------------------------------------------------------
-- Payments — one row per gateway attempt; idempotent on (provider, provider_ref)
-- ---------------------------------------------------------------------------
create table payments (
  id           uuid primary key default uuid_generate_v4(),
  order_id     uuid not null references orders (id) on delete cascade,
  provider     text not null,
  provider_ref text,
  status       payment_status not null default 'pending',
  amount_sen   integer not null check (amount_sen >= 0),
  raw          jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index payments_provider_ref_idx
  on payments (provider, provider_ref) where provider_ref is not null;
create index payments_order_idx on payments (order_id);
alter table payments enable row level security;
create trigger payments_updated_at before update on payments
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Stock ledger — the audit trail; every stock change is a row here (§4.2)
-- ---------------------------------------------------------------------------
create table stock_movements (
  id                 uuid primary key default uuid_generate_v4(),
  product_variant_id uuid not null references product_variants (id) on delete cascade,
  type               stock_movement_type not null,
  qty_delta          integer not null,   -- negative = out (sale), positive = in
  order_id           uuid references orders (id) on delete set null,
  reason             text,
  created_at         timestamptz not null default now()
);
create index stock_movements_variant_idx on stock_movements (product_variant_id);
create index stock_movements_order_idx on stock_movements (order_id) where order_id is not null;
alter table stock_movements enable row level security;

-- ---------------------------------------------------------------------------
-- Discounts (foundation reused by affiliate + loyalty)
-- ---------------------------------------------------------------------------
create table discount_codes (
  id              uuid primary key default uuid_generate_v4(),
  code            text not null unique,
  kind            text not null check (kind in ('percent', 'fixed', 'free_shipping')),
  -- percent: 0..100; fixed: sen off; free_shipping: ignored
  amount          integer not null default 0,
  min_spend_sen   integer not null default 0,
  max_redemptions integer,
  redeemed_count  integer not null default 0,
  starts_at       timestamptz,
  ends_at         timestamptz,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
alter table discount_codes enable row level security;

create table discount_redemptions (
  id               uuid primary key default uuid_generate_v4(),
  discount_code_id uuid not null references discount_codes (id) on delete cascade,
  order_id         uuid not null references orders (id) on delete cascade,
  user_id          uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index discount_redemptions_code_idx on discount_redemptions (discount_code_id);
alter table discount_redemptions enable row level security;

-- ===========================================================================
-- RLS
-- ===========================================================================

-- Addresses: own + staff.
create policy "own addresses" on addresses for all
  using ((select auth.uid()) = user_id or (select private.is_staff()))
  with check ((select auth.uid()) = user_id or (select private.is_staff()));

-- Orders: a signed-in customer sees their own; staff see all. Guest orders
-- (user_id null) are reachable only via get_order_by_reference (definer).
create policy "own orders, staff all" on orders for select
  using (
    (user_id is not null and (select auth.uid()) = user_id)
    or (select private.is_staff())
  );
create policy "staff manage orders" on orders for all
  using ((select private.is_staff())) with check ((select private.is_staff()));

create policy "order items follow order" on order_items for select
  using (exists (
    select 1 from orders o where o.id = order_items.order_id
      and ((o.user_id is not null and (select auth.uid()) = o.user_id) or (select private.is_staff()))
  ));
create policy "staff manage order items" on order_items for all
  using ((select private.is_staff())) with check ((select private.is_staff()));

-- Payments, stock ledger, redemptions: staff only (order.status is what the
-- customer sees). Definer functions bypass these for the flows that need them.
create policy "staff read payments" on payments for all
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy "staff read stock_movements" on stock_movements for all
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy "staff read redemptions" on discount_redemptions for all
  using ((select private.is_staff())) with check ((select private.is_staff()));

-- Discount codes: staff manage. Validation for shoppers goes through
-- validate_discount (definer), so no public read policy.
create policy "staff manage discounts" on discount_codes for all
  using ((select private.is_staff())) with check ((select private.is_staff()));

grant select, insert, update, delete on addresses to authenticated;
grant select on orders, order_items to authenticated;
