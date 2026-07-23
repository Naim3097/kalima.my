/*
  Phase 6 — affiliate program.

  Commission is money, so the same rules as the rest of the system apply: it is
  integer sen, it is computed server-side from the order (never supplied by a
  caller), and it moves only through functions that can be reasoned about.

  Attribution has two paths — an affiliate's discount code, or a ?ref link that
  sets a 30-day cookie. An explicit code beats an ambient cookie, and an order
  can only ever produce ONE referral row (unique on order_id), so the two paths
  can never double-pay.
*/

create type affiliate_status  as enum ('pending', 'approved', 'suspended');
create type referral_status   as enum ('pending', 'approved', 'paid', 'clawed_back');

create table affiliates (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid unique references auth.users (id) on delete set null,
  email          text not null unique,
  name           text not null,
  -- The ?ref= value. Lower-case, url-safe.
  slug           text not null unique,
  -- Their discount code, if issued. Links to the existing discount engine.
  discount_code  text,
  -- Commission in basis points (1000 = 10%). Per-affiliate override of the default.
  commission_bps integer not null default 1000 check (commission_bps between 0 and 10000),
  status         affiliate_status not null default 'pending',
  payout_note    text,          -- bank / DuitNow reference, entered by staff
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index affiliates_slug_idx on affiliates (slug) where status = 'approved';
alter table affiliates enable row level security;
create trigger affiliates_updated_at before update on affiliates
  for each row execute function set_updated_at();

-- An affiliate sees only their own row; staff see all.
create policy "affiliates read own" on affiliates for select
  using (user_id = (select auth.uid()) or (select private.is_staff()));
create policy "staff manage affiliates" on affiliates for all
  using ((select private.is_staff())) with check ((select private.is_staff()));
grant select on affiliates to authenticated;

create table affiliate_clicks (
  id           uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references affiliates (id) on delete cascade,
  -- Coarse only: a hash, never a raw IP, and no user agent. Click volume is
  -- the metric; identifying visitors is not the purpose.
  visitor_hash text,
  created_at   timestamptz not null default now()
);
create index affiliate_clicks_affiliate_idx on affiliate_clicks (affiliate_id, created_at desc);
alter table affiliate_clicks enable row level security;
create policy "staff read clicks" on affiliate_clicks for all
  using ((select private.is_staff())) with check ((select private.is_staff()));

create table affiliate_referrals (
  id             uuid primary key default gen_random_uuid(),
  affiliate_id   uuid not null references affiliates (id) on delete cascade,
  -- One referral per order, enforced: the code path and the link path can never
  -- both pay out for the same sale.
  order_id       uuid not null unique references orders (id) on delete cascade,
  -- Commission base excludes shipping and tax — an affiliate earns on goods,
  -- not on postage the store merely passes through.
  base_sen       integer not null check (base_sen >= 0),
  commission_sen integer not null check (commission_sen >= 0),
  commission_bps integer not null,
  source         text not null,          -- 'code' | 'link'
  status         referral_status not null default 'pending',
  -- Commission is not payable until the return window closes.
  hold_until     timestamptz not null,
  paid_at        timestamptz,
  payout_id      uuid,
  created_at     timestamptz not null default now()
);
create index affiliate_referrals_affiliate_idx on affiliate_referrals (affiliate_id, status);
alter table affiliate_referrals enable row level security;
create policy "affiliates read own referrals" on affiliate_referrals for select
  using (
    exists (select 1 from affiliates a
             where a.id = affiliate_referrals.affiliate_id and a.user_id = (select auth.uid()))
    or (select private.is_staff())
  );
create policy "staff manage referrals" on affiliate_referrals for all
  using ((select private.is_staff())) with check ((select private.is_staff()));
grant select on affiliate_referrals to authenticated;

create table affiliate_payouts (
  id           uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references affiliates (id) on delete cascade,
  amount_sen   integer not null check (amount_sen > 0),
  reference    text,              -- DuitNow / transfer reference, entered by staff
  note         text,
  paid_at      timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index affiliate_payouts_affiliate_idx on affiliate_payouts (affiliate_id);
alter table affiliate_payouts enable row level security;
create policy "affiliates read own payouts" on affiliate_payouts for select
  using (
    exists (select 1 from affiliates a
             where a.id = affiliate_payouts.affiliate_id and a.user_id = (select auth.uid()))
    or (select private.is_staff())
  );
create policy "staff manage payouts" on affiliate_payouts for all
  using ((select private.is_staff())) with check ((select private.is_staff()));
grant select on affiliate_payouts to authenticated;

-- Which affiliate link the order arrived through, captured at checkout.
alter table orders add column affiliate_ref text;
