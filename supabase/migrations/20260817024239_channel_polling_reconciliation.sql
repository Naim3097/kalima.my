/*
  Phase 8 — polling reconciliation: the safety net underneath the webhooks.

  Webhooks are the fast path, and they are not trustworthy enough to be the
  ONLY path. A delivery can be dropped, retried past its window, sent while a
  deploy is rolling, or never sent at all because a subscription silently
  lapsed. Nothing in the current design would notice: the ledger simply stops
  receiving a sale that happened, and our count drifts above the marketplace's
  until someone buys the unit we no longer have. That is an oversell, a
  cancelled Shopee order and a seller-performance penalty.

  So this migration adds the three things a polling worker needs and the
  webhook path does not have:

    - a CURSOR, so an order poll knows where it left off
    - ENQUEUE HELPERS, so channel-wide poll/reconcile work reaches the same
      debounced queue that stock pushes already use
    - a RECONCILE STAMP, so a bounded batch can rotate through listings
      instead of re-checking the same ones every run

  Deliberately NOT added: any second path that moves stock. A polled order is
  imported through record_channel_sale, exactly like a webhook order — it is
  already idempotent on (channel, external_order_id), and that unique index is
  what makes re-importing an overlapping window free. Writing a separate
  "polled sale" path would be the fifth stock call site this project has
  already been bitten by twice.
*/

-- =========================================================================
-- The order-poll cursor
-- =========================================================================

/*
  How far the order poll has READ, per channel.

  Deliberately distinct from last_sync_at, which records when a sync last RAN.
  The two diverge the moment a run fails, and using "when we last ran" as a
  cursor would skip every order in the failed window — silently, and forever,
  because the next run starts after the gap it just created.

  Null means "never polled". The worker then falls back to a bounded first-run
  lookback rather than asking a marketplace for all of history.
*/
alter table channel_connections add column orders_polled_through timestamptz;

/*
  Advances the cursor, and NEVER retreats it.

  greatest() rather than a plain assignment because two runs can overlap: the
  5-minute poll and the nightly reconcile sweep can both be in flight, and the
  slower one finishing second must not rewind the cursor to its own older
  window. A rewound cursor is not merely wasteful — it re-imports a window that
  record_channel_sale will correctly reject as duplicates, which reads in the
  activity log as a poll that found nothing new, hiding a real gap.
*/
create function public.advance_order_cursor(
  p_channel sales_channel,
  p_through timestamptz
)
returns void
language sql
security definer
set search_path = ''
as $$
  /*
    greatest/coalesce are unqualified deliberately: they are parser constructs,
    not schema members, so `pg_catalog.greatest(...)` does not resolve even
    under `search_path = ''`. pg_catalog.now() is a genuine function and is
    qualified — the same split every function in 20260803074500 makes.
  */
  update public.channel_connections
     set orders_polled_through = greatest(coalesce(orders_polled_through, p_through), p_through),
         last_sync_at = pg_catalog.now()
   where channel = p_channel;
$$;

-- =========================================================================
-- Reconcile rotation
-- =========================================================================

/*
  When this listing's quantity was last compared against the marketplace's own
  figure. Null means never.

  The worker orders by this (nulls first) and takes a bounded batch, so a shop
  with more listings than one function invocation can check still makes
  progress on all of them across runs, oldest first. Without the column the
  batch would re-check the same first N listings forever and the tail would
  never be reconciled at all.
*/
alter table channel_listings add column last_reconciled_at timestamptz;

/*
  Records that a listing was checked, and what the marketplace said.

  Sibling of mark_listing_pushed, and stamped whether or not drift was found —
  "checked and agreed" is exactly as important to record as "checked and
  differed", because it is what moves this listing to the back of the rotation.
*/
create function public.mark_listing_reconciled(
  p_listing_id uuid,
  p_their_qty  integer default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.channel_listings
     set last_reconciled_at = pg_catalog.now(),
         -- Their figure IS our new knowledge of what they hold. Recording it
         -- here means the admin's "last pushed" column stops lying after a
         -- drift correction lands.
         last_pushed_qty = coalesce(p_their_qty, last_pushed_qty)
   where id = p_listing_id;
$$;

-- =========================================================================
-- Enqueue helpers
-- =========================================================================

/*
  WHY THESE ARE SQL FUNCTIONS AND NOT SUPABASE UPSERTS.

  channel_sync_jobs is debounced by two PARTIAL unique indexes
  (channel_sync_jobs_pending_push_idx, channel_sync_jobs_pending_channel_idx).
  Postgres will only infer a partial index as an ON CONFLICT arbiter if the
  statement repeats the index predicate, so a targeted
  `on conflict (listing_id) do nothing` does not match one and raises

      42P10: there is no unique or exclusion constraint matching the
             ON CONFLICT specification

  That is not hypothetical. lib/channels/sync.ts:enqueueFullResync issued
  exactly that statement via `.upsert(rows, {onConflict: "listing_id",
  ignoreDuplicates: true})`, which means the admin's "Re-sync all" button has
  been raising 42P10 for every press since it shipped — verified against this
  database on Postgres 17.

  A BARE `on conflict do nothing` needs no arbiter inference and therefore
  honours every unique index on the table, partial ones included. It is what
  private.enqueue_stock_push has always used, which is why the trigger path
  worked while the button did not. Putting the inserts behind functions means
  there is one correct spelling and no caller can reintroduce the broken one.
*/

/*
  Queues a channel-wide job (pull_orders / reconcile).

  Returns true when a job was actually created, false when one was already
  queued for that channel and kind — the caller wants to log "queued a poll"
  only when it really queued one.
*/
create function public.enqueue_channel_job(
  p_channel sales_channel,
  p_kind    channel_job_kind
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  /*
    push_stock is per-listing and would insert a listing-less row that the
    worker cannot act on and the channel-wide debounce index would then block
    for every other channel-wide job. Refuse it loudly rather than queue
    something inert.
  */
  if p_kind = 'push_stock' then
    raise exception 'push_stock is a per-listing job — use enqueue_listing_pushes';
  end if;

  insert into public.channel_sync_jobs (channel, kind, listing_id)
  values (p_channel, p_kind, null)
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$$;

/*
  Queues a stock push for one listing — the drift correction the reconcile
  sweep issues when a marketplace's figure disagrees with ours.
*/
create function public.enqueue_listing_push(p_listing_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  insert into public.channel_sync_jobs (channel, kind, listing_id)
  select l.channel, 'push_stock', l.id
    from public.channel_listings l
   where l.id = p_listing_id
     and l.sync_enabled
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$$;

/*
  Queues a stock push for every mapped listing, optionally scoped to one
  channel — the "Re-sync all" button.

  Returns the number of jobs ACTUALLY created, not the number of listings
  considered. The button previously reported the latter, so a second press
  during a busy period claimed to have queued work the debounce had in fact
  collapsed.
*/
create function public.enqueue_listing_pushes(p_channel sales_channel default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  insert into public.channel_sync_jobs (channel, kind, listing_id)
  select l.channel, 'push_stock', l.id
    from public.channel_listings l
   where l.sync_enabled
     and (p_channel is null or l.channel = p_channel)
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- =========================================================================
-- Grants
-- =========================================================================

/*
  All three of public, anon and authenticated — `public` covers Postgres's
  built-in EXECUTE grant and the other two cover Supabase's defaults. Granting
  without revoking permits nothing new; that is precisely how the Phase 7
  loyalty reads ended up world-readable (see 20260803064500).
*/
revoke all on function public.advance_order_cursor(sales_channel, timestamptz)   from public, anon, authenticated;
revoke all on function public.mark_listing_reconciled(uuid, integer)             from public, anon, authenticated;
revoke all on function public.enqueue_channel_job(sales_channel, channel_job_kind) from public, anon, authenticated;
revoke all on function public.enqueue_listing_push(uuid)                         from public, anon, authenticated;
revoke all on function public.enqueue_listing_pushes(sales_channel)              from public, anon, authenticated;

grant execute on function public.advance_order_cursor(sales_channel, timestamptz)   to service_role;
grant execute on function public.mark_listing_reconciled(uuid, integer)             to service_role;
grant execute on function public.enqueue_channel_job(sales_channel, channel_job_kind) to service_role;
grant execute on function public.enqueue_listing_push(uuid)                         to service_role;
grant execute on function public.enqueue_listing_pushes(sales_channel)              to service_role;
