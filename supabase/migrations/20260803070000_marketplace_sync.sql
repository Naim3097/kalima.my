/*
  Phase 8 — marketplace stock sync (Shopee + TikTok Shop).

  The website database stays the single source of truth for inventory. Every
  movement continues to go through stock_movements; this migration adds the
  mapping from a variant to its marketplace listings, an outbox of sync work,
  and the inbound path for a marketplace sale.

  ONE TRIGGER, NOT FIVE CALL SITES. Stock moves in five places today —
  mark_order_paid (sale), refund_order (release), adjust_stock (manual), the CSV
  importer via adjust_stock, and now marketplace sales. Hooking each one is the
  mistake this project has already made twice: loyalty point reversal was wired
  into the admin refund ACTION rather than refund_order, so the gateway refund
  path silently destroyed points. So outbound sync hangs off an AFTER INSERT
  trigger on the ledger itself. Every path is covered, including any path added
  later by someone who has never read this file.
*/

-- Which channel caused a movement. Null means kalima.my. The sync trigger reads
-- it as a loop guard: a Shopee sale must never be pushed back to Shopee.
alter table stock_movements add column origin_channel sales_channel;

-- =========================================================================
-- Listings: variant <-> marketplace item
-- =========================================================================

create table channel_listings (
  id                uuid primary key default gen_random_uuid(),
  channel           sales_channel not null,
  variant_id        uuid not null references product_variants (id) on delete cascade,
  -- The marketplace's product id, and its per-variation id where it has one
  -- (Shopee model_id, TikTok sku_id). Null for a single-variation listing.
  external_item_id  text not null,
  external_model_id text,
  -- The marketplace's own SKU string, used to auto-match against our sku.
  external_sku      text,
  -- Units held back from the marketplace, so a race there cannot oversell us.
  safety_buffer     integer not null default 0 check (safety_buffer >= 0),
  sync_enabled      boolean not null default true,
  last_pushed_qty   integer,
  last_pushed_at    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

/*
  Both directions of the mapping are unique, and both matter:
  - one listing per variant per channel, or "push this variant's stock" has no
    single answer
  - one variant per listing, or two variants would each claim the same
    marketplace listing and the last push would win at random
*/
create unique index channel_listings_variant_idx
  on channel_listings (channel, variant_id);
create unique index channel_listings_external_idx
  on channel_listings (channel, external_item_id, coalesce(external_model_id, ''));

create trigger channel_listings_updated_at before update on channel_listings
  for each row execute function set_updated_at();

-- =========================================================================
-- Imported marketplace orders — VISIBILITY ONLY
-- =========================================================================

/*
  Marketplace sales are deliberately NOT written into `orders`.

  Shopee and TikTok mandate their own fulfilment and their own refunds, so an
  imported row could never be shipped, refunded or packed from here. Putting it
  in `orders` would mean every downstream money path — refund_order,
  award_loyalty_points, attribute_referral, packing slips, LeanX payment rows —
  needed a channel guard, and each guard we forgot would be a real bug. A
  separate table cannot be reached by any of them by construction.

  What these rows DO is decrement stock through the ledger and appear in the
  admin with a channel badge.
*/
create table channel_orders (
  id                uuid primary key default gen_random_uuid(),
  channel           sales_channel not null,
  external_order_id text not null,
  -- The marketplace's own status string, kept raw: mapping it to our
  -- order_status enum would imply a lifecycle we do not control.
  status            text,
  buyer_name        text,
  total_sen         integer check (total_sen >= 0),
  ordered_at        timestamptz,
  -- Whether this order's stock decrement has been applied. Separate from the
  -- row existing, so a partial failure cannot silently skip the ledger.
  stock_applied     boolean not null default false,
  -- The payload as received, so a mapping bug is diagnosable after the fact.
  raw               jsonb,
  created_at        timestamptz not null default now()
);

-- The idempotency anchor: a redelivered webhook cannot import twice.
create unique index channel_orders_external_idx
  on channel_orders (channel, external_order_id);
create index channel_orders_ordered_at_idx on channel_orders (ordered_at desc);

create table channel_order_items (
  id                uuid primary key default gen_random_uuid(),
  channel_order_id  uuid not null references channel_orders (id) on delete cascade,
  external_item_id  text not null,
  external_model_id text,
  -- Null when the listing is not mapped yet. The row is still recorded, so the
  -- unmapped report has something to show and the sale is not lost.
  variant_id        uuid references product_variants (id) on delete set null,
  qty               integer not null check (qty > 0),
  unit_price_sen    integer check (unit_price_sen >= 0),
  -- How much stock this line actually removed. Differs from qty only on an
  -- oversell, where it is clamped -- see record_channel_sale.
  applied_qty       integer not null default 0 check (applied_qty >= 0)
);

create index channel_order_items_order_idx on channel_order_items (channel_order_id);

-- =========================================================================
-- Outbox + activity log
-- =========================================================================

create type channel_job_kind   as enum ('push_stock', 'pull_orders', 'reconcile');
create type channel_job_status as enum ('queued', 'running', 'done', 'failed');

create table channel_sync_jobs (
  id              uuid primary key default gen_random_uuid(),
  channel         sales_channel not null,
  kind            channel_job_kind not null,
  listing_id      uuid references channel_listings (id) on delete cascade,
  status          channel_job_status not null default 'queued',
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

/*
  THE DEBOUNCE. At most one QUEUED push per listing, so ten rapid movements
  collapse into one push.

  This is safe only because a job carries no quantity — it is an intent to
  resync, and the worker reads current stock when it runs. A job carrying a
  delta could not be collapsed without arithmetic, and a stale delta is how
  counts drift apart.

  Deliberately scoped to 'queued' and NOT 'running': a job already in flight may
  have read stock before the movement that just landed, so that movement needs
  its own job. Pushing the same quantity twice is harmless; missing one is not.
*/
create unique index channel_sync_jobs_pending_push_idx
  on channel_sync_jobs (listing_id)
  where kind = 'push_stock' and status = 'queued';

-- Channel-wide jobs (order pull, reconciliation) collapse per channel.
create unique index channel_sync_jobs_pending_channel_idx
  on channel_sync_jobs (channel, kind)
  where listing_id is null and status = 'queued';

create index channel_sync_jobs_claimable_idx
  on channel_sync_jobs (next_attempt_at)
  where status = 'queued';

create trigger channel_sync_jobs_updated_at before update on channel_sync_jobs
  for each row execute function set_updated_at();

create type channel_log_level as enum ('info', 'warning', 'error');

create table channel_sync_log (
  id         uuid primary key default gen_random_uuid(),
  channel    sales_channel,
  level      channel_log_level not null default 'info',
  -- Machine-stable, for filtering: stock_pushed, order_imported, oversell,
  -- push_failed, unmapped_listing, reconciled.
  event      text not null,
  summary    text not null,
  variant_id uuid references product_variants (id) on delete set null,
  meta       jsonb,
  created_at timestamptz not null default now()
);

create index channel_sync_log_recent_idx on channel_sync_log (created_at desc);

-- =========================================================================
-- RLS
-- =========================================================================

/*
  Staff may read all of it — the admin screens are the point. Nothing carries a
  write policy: every mutation runs through the service-role functions and
  server actions below, so the activity log and the job queue cannot be edited
  from a session, only appended to by the server.
*/
alter table channel_listings    enable row level security;
alter table channel_orders      enable row level security;
alter table channel_order_items enable row level security;
alter table channel_sync_jobs   enable row level security;
alter table channel_sync_log    enable row level security;

create policy "staff read listings"    on channel_listings    for select using ((select private.is_staff()));
create policy "staff read ch orders"   on channel_orders      for select using ((select private.is_staff()));
create policy "staff read ch items"    on channel_order_items for select using ((select private.is_staff()));
create policy "staff read sync jobs"   on channel_sync_jobs   for select using ((select private.is_staff()));
create policy "staff read sync log"    on channel_sync_log    for select using ((select private.is_staff()));

grant select on channel_listings, channel_orders, channel_order_items,
                channel_sync_jobs, channel_sync_log to authenticated;

-- =========================================================================
-- Outbound: enqueue a resync whenever stock moves
-- =========================================================================

/*
  Lives in `private`, which PostgREST does not expose — a trigger function must
  never be callable directly. Same treatment the auth helpers got in
  20260722052547.
*/
create function private.enqueue_stock_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.channel_sync_jobs (channel, kind, listing_id)
  select l.channel, 'push_stock', l.id
    from public.channel_listings l
   where l.variant_id = new.product_variant_id
     and l.sync_enabled
     -- Loop guard: never push a sale back to the channel that made it.
     and (new.origin_channel is null or l.channel <> new.origin_channel)
  -- Relies on channel_sync_jobs_pending_push_idx: an existing queued job
  -- already means "resync this listing", so it covers this movement too.
  on conflict do nothing;

  return null;
end;
$$;

create trigger stock_movements_enqueue_sync
  after insert on stock_movements
  for each row execute function private.enqueue_stock_push();

-- =========================================================================
-- Inbound: a marketplace sale
-- =========================================================================

/*
  Records a marketplace order and removes its stock through the ledger.

  Idempotent on (channel, external_order_id): a redelivered webhook returns
  'already recorded' and touches nothing.

  OVERSELL POLICY. product_variants.stock_on_hand carries a check constraint of
  >= 0, and a marketplace sale is a fact that has already happened — we cannot
  refuse it the way create_order refuses a website order it cannot fulfil. So
  the decrement is CLAMPED to what we hold, the ledger records what actually
  moved, and the shortfall is logged at level 'error' as an oversell. Silently
  writing the full quantity would be a lie about our own inventory; refusing the
  order outright would lose the record of a sale that exists regardless.

  Unmapped lines are recorded with variant_id null rather than dropped. The sale
  happened; we simply do not know which variant it was, and the unmapped report
  is how someone finds out.

  service_role only, like every other function that moves stock or money.
*/
create function public.record_channel_sale(
  p_channel           sales_channel,
  p_external_order_id text,
  p_status            text,
  p_buyer_name        text,
  p_total_sen         integer,
  p_ordered_at        timestamptz,
  p_items             jsonb,
  p_raw               jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id   uuid;
  it           jsonb;
  v_listing    public.channel_listings;
  v_qty        integer;
  v_applied    integer;
  v_available  integer;
  v_total_items integer := 0;
  v_unmapped   integer := 0;
  v_oversold   integer := 0;
begin
  if p_external_order_id is null or length(trim(p_external_order_id)) = 0 then
    raise exception 'external order id is required';
  end if;

  insert into public.channel_orders
    (channel, external_order_id, status, buyer_name, total_sen, ordered_at, raw)
  values
    (p_channel, p_external_order_id, p_status, p_buyer_name, p_total_sen, p_ordered_at, p_raw)
  on conflict (channel, external_order_id) do nothing
  returning id into v_order_id;

  if v_order_id is null then
    return jsonb_build_object('applied', false, 'reason', 'already recorded');
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_total_items := v_total_items + 1;
    v_qty := greatest(coalesce((it ->> 'qty')::integer, 0), 0);

    select * into v_listing
      from public.channel_listings l
     where l.channel = p_channel
       and l.external_item_id = (it ->> 'external_item_id')
       and coalesce(l.external_model_id, '') = coalesce(it ->> 'external_model_id', '');

    if not found then
      v_unmapped := v_unmapped + 1;
      insert into public.channel_order_items
        (channel_order_id, external_item_id, external_model_id, variant_id, qty, unit_price_sen, applied_qty)
      values
        (v_order_id, it ->> 'external_item_id', it ->> 'external_model_id', null, greatest(v_qty, 1),
         (it ->> 'unit_price_sen')::integer, 0);

      insert into public.channel_sync_log (channel, level, event, summary, meta)
      values (p_channel, 'warning', 'unmapped_listing',
              'Order ' || p_external_order_id || ' contains an unmapped listing',
              jsonb_build_object('external_item_id', it ->> 'external_item_id',
                                 'external_model_id', it ->> 'external_model_id'));
      continue;
    end if;

    -- Clamp to what we actually hold; see the oversell note above.
    select v.stock_on_hand into v_available
      from public.product_variants v where v.id = v_listing.variant_id;
    v_applied := least(v_qty, coalesce(v_available, 0));

    if v_applied > 0 then
      update public.product_variants
         set stock_on_hand = stock_on_hand - v_applied
       where id = v_listing.variant_id;

      insert into public.stock_movements
        (product_variant_id, type, qty_delta, reason, origin_channel)
      values
        (v_listing.variant_id, 'marketplace_sync', -v_applied,
         p_channel::text || ' order ' || p_external_order_id, p_channel);
    end if;

    insert into public.channel_order_items
      (channel_order_id, external_item_id, external_model_id, variant_id, qty, unit_price_sen, applied_qty)
    values
      (v_order_id, it ->> 'external_item_id', it ->> 'external_model_id', v_listing.variant_id,
       greatest(v_qty, 1), (it ->> 'unit_price_sen')::integer, v_applied);

    if v_applied < v_qty then
      v_oversold := v_oversold + 1;
      insert into public.channel_sync_log (channel, level, event, summary, variant_id, meta)
      values (p_channel, 'error', 'oversell',
              'Oversold on ' || p_channel::text || ': sold ' || v_qty ||
              ' but only ' || v_applied || ' were in stock',
              v_listing.variant_id,
              jsonb_build_object('external_order_id', p_external_order_id,
                                 'sold', v_qty, 'applied', v_applied));
    end if;
  end loop;

  update public.channel_orders set stock_applied = true where id = v_order_id;

  insert into public.channel_sync_log (channel, level, event, summary, meta)
  values (p_channel,
          -- Explicit cast: a CASE of bare literals is text, and Postgres will
          -- not coerce it to the enum on its own.
          (case when v_oversold > 0 then 'error'
                when v_unmapped > 0 then 'warning'
                else 'info' end)::public.channel_log_level,
          'order_imported',
          'Imported ' || p_channel::text || ' order ' || p_external_order_id ||
          ' (' || v_total_items || ' line(s))',
          jsonb_build_object('unmapped', v_unmapped, 'oversold', v_oversold));

  return jsonb_build_object(
    'applied', true, 'order_id', v_order_id,
    'lines', v_total_items, 'unmapped', v_unmapped, 'oversold', v_oversold
  );
end;
$$;

/*
  All three of public, anon and authenticated — `public` covers Postgres's
  built-in EXECUTE grant and the other two cover Supabase's default privileges.
  Granting without revoking permits nothing new; that is precisely how the
  Phase 7 loyalty reads ended up world-readable (see 20260803064500).
*/
revoke all on function public.record_channel_sale(sales_channel, text, text, text, integer, timestamptz, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_channel_sale(sales_channel, text, text, text, integer, timestamptz, jsonb, jsonb)
  to service_role;
