/*
  Phase 4 — shipments.

  Courier-agnostic on purpose. EasyParcel will populate provider/provider_ref/
  label_url once its API is wired, but the same row works today for a parcel
  booked by hand at any counter — so the client can ship and give customers
  tracking immediately, rather than waiting on an API key.

  One order can have several shipments (a split delivery), so this is a table
  rather than columns on orders.
*/
create type shipment_status as enum (
  'pending', 'booked', 'in_transit', 'delivered', 'returned', 'cancelled'
);

create table shipments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders (id) on delete cascade,
  -- 'manual' until a gateway books it; then 'easyparcel'.
  provider      text not null default 'manual',
  provider_ref  text,
  courier       text,
  tracking_no   text,
  tracking_url  text,
  label_url     text,
  status        shipment_status not null default 'pending',
  weight_grams  integer not null default 0 check (weight_grams >= 0),
  cost_sen      integer not null default 0 check (cost_sen >= 0),
  notes         text,
  shipped_at    timestamptz,
  delivered_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index shipments_order_idx on shipments (order_id);
create index shipments_tracking_idx on shipments (tracking_no) where tracking_no is not null;
-- A gateway booking is unique per provider reference; hand-entered rows are exempt.
create unique index shipments_provider_ref_idx
  on shipments (provider, provider_ref) where provider_ref is not null;

alter table shipments enable row level security;
create trigger shipments_updated_at before update on shipments
  for each row execute function set_updated_at();

/*
  A customer may see the tracking for their OWN order (guests reach it through
  the definer-guarded order lookup instead). Staff manage everything.
*/
create policy "customers read own shipments" on shipments for select
  using (
    exists (
      select 1 from orders o
      where o.id = shipments.order_id
        and o.user_id is not null
        and o.user_id = (select auth.uid())
    )
    or (select private.is_staff())
  );

create policy "staff manage shipments" on shipments for all
  using ((select private.is_staff())) with check ((select private.is_staff()));

grant select on shipments to authenticated;
revoke all on shipments from anon;
