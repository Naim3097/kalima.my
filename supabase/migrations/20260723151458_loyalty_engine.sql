/*
  Phase 7 — Kalima Club loyalty.

  Points are a liability the shop owes its customers, so they are modelled the
  same way stock and commission are: as a LEDGER, never a stored balance. A
  running total that can drift from the entries it summarises is how a customer
  ends up spending points twice.

  Balance = sum of unexpired entries. Earning is signed positive, redemption
  negative, expiry negative — one table, one arithmetic.
*/

create type loyalty_entry_type as enum ('earn', 'redeem', 'expire', 'adjust');

-- Single-row config, so the shop can retune the scheme without a deploy.
create table loyalty_rules (
  id                  int primary key default 1 check (id = 1),
  -- Points earned per whole ringgit of qualifying spend.
  points_per_rm       integer not null default 1 check (points_per_rm >= 0),
  -- Redemption value: sen per point. 5 => 100 points = RM5.
  sen_per_point       integer not null default 5 check (sen_per_point >= 0),
  min_redeem_points   integer not null default 100 check (min_redeem_points >= 0),
  -- Ceiling on how much of an order points may cover, in basis points.
  max_redeem_bps      integer not null default 5000 check (max_redeem_bps between 0 and 10000),
  expiry_months       integer not null default 12 check (expiry_months > 0),
  enabled             boolean not null default true,
  updated_at          timestamptz not null default now()
);
insert into loyalty_rules (id) values (1);

alter table loyalty_rules enable row level security;
create trigger loyalty_rules_updated_at before update on loyalty_rules
  for each row execute function set_updated_at();
-- Redemption value is not a secret; the storefront shows it.
create policy "loyalty rules are public" on loyalty_rules for select using (true);
create policy "staff manage loyalty rules" on loyalty_rules for all
  using ((select private.is_staff())) with check ((select private.is_staff()));
grant select on loyalty_rules to anon, authenticated;

create table membership_tiers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  -- Qualifying 12-month spend to reach this tier.
  min_spend_sen  integer not null default 0 check (min_spend_sen >= 0),
  -- Earn multiplier in basis points. 10000 = 1x, 15000 = 1.5x.
  multiplier_bps integer not null default 10000 check (multiplier_bps > 0),
  free_shipping  boolean not null default false,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now()
);

alter table membership_tiers enable row level security;
create policy "tiers are public" on membership_tiers for select using (true);
create policy "staff manage tiers" on membership_tiers for all
  using ((select private.is_staff())) with check ((select private.is_staff()));
grant select on membership_tiers to anon, authenticated;

insert into membership_tiers (name, min_spend_sen, multiplier_bps, free_shipping, sort_order) values
  ('Member',   0,       10000, false, 0),
  ('Gold',     100000,  15000, false, 1),
  ('Platinum', 300000,  20000, true,  2);

create table loyalty_ledger (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  order_id   uuid references orders (id) on delete set null,
  type       loyalty_entry_type not null,
  -- Signed: positive earns, negative redeems/expires.
  points     integer not null,
  reason     text,
  -- Null for redemptions and expiries; earnings expire.
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index loyalty_ledger_user_idx on loyalty_ledger (user_id, created_at desc);
-- One earn entry per order, enforced: a replayed completion cannot pay twice.
create unique index loyalty_ledger_earn_once_idx
  on loyalty_ledger (order_id) where type = 'earn' and order_id is not null;

alter table loyalty_ledger enable row level security;
create policy "customers read own ledger" on loyalty_ledger for select
  using (user_id = (select auth.uid()) or (select private.is_staff()));
create policy "staff manage ledger" on loyalty_ledger for all
  using ((select private.is_staff())) with check ((select private.is_staff()));
grant select on loyalty_ledger to authenticated;
