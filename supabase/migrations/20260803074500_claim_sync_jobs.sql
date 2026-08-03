/*
  Atomic job claiming for the sync worker.

  The worker runs on a cron, and two runs can overlap — a slow drain still
  executing when the next minute fires. Claiming has to be atomic or both would
  push the same listing twice, which is harmless for stock but wasteful, and
  would double-count against a marketplace's rate limit.

  `for update skip locked` is the right primitive: each worker takes rows nobody
  else holds and never blocks waiting for a row another worker already has. This
  is the same race defence bookShipment applies with its conditional
  pending -> booked update, expressed the way Postgres does queues.

  ONLY CLAIMS WORK IT CAN DO. p_channels is the set of channels whose adapter is
  actually wired and connected. Without it, jobs for an unconnected marketplace
  would be claimed, fail, burn their retry budget and land in 'failed' — so
  connecting Shopee a week later would find a pile of dead jobs instead of
  pending ones. Unready channels are simply not picked up, and their jobs wait.

  Returns everything the push needs in one round trip: the worker should not
  have to query per job to find out what quantity to send.
*/
create function public.claim_sync_jobs(
  p_limit    integer default 20,
  p_channels sales_channel[] default null
)
returns table (
  job_id            uuid,
  channel           sales_channel,
  kind              channel_job_kind,
  attempts          integer,
  listing_id        uuid,
  external_item_id  text,
  external_model_id text,
  variant_id        uuid,
  sku               text,
  stock_on_hand     integer,
  safety_buffer     integer
)
language sql
security definer
set search_path = ''
as $$
  with claimed as (
    update public.channel_sync_jobs j
       set status = 'running',
           attempts = j.attempts + 1,
           updated_at = pg_catalog.now()
     where j.id in (
       select c.id
         from public.channel_sync_jobs c
        where c.status = 'queued'
          and c.next_attempt_at <= pg_catalog.now()
          and (p_channels is null or c.channel = any (p_channels))
        order by c.next_attempt_at
        limit greatest(coalesce(p_limit, 20), 1)
        for update skip locked
     )
    returning j.id, j.channel, j.kind, j.attempts, j.listing_id
  )
  select c.id, c.channel, c.kind, c.attempts,
         c.listing_id, l.external_item_id, l.external_model_id,
         l.variant_id, v.sku, v.stock_on_hand, l.safety_buffer
    from claimed c
    left join public.channel_listings l on l.id = c.listing_id
    left join public.product_variants  v on v.id = l.variant_id;
$$;

/*
  Releases a claimed job.

  On success it is 'done'. On failure it goes back to 'queued' with an
  exponential next_attempt_at, until the attempt budget is spent and it becomes
  'failed' — a job that retries forever hides a permanent fault behind noise.

  Returning to 'queued' rather than staying 'running' matters: the partial
  unique index that debounces pushes only covers 'queued', so a released job
  reoccupies that slot and a movement arriving during the retry wait collapses
  into it rather than queueing a second.
*/
create function public.release_sync_job(
  p_job_id  uuid,
  p_ok      boolean,
  p_error   text default null,
  p_max_attempts integer default 6
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
  v_backoff  interval;
begin
  select attempts into v_attempts from public.channel_sync_jobs where id = p_job_id;
  if not found then return; end if;

  if p_ok then
    update public.channel_sync_jobs
       set status = 'done', last_error = null
     where id = p_job_id;
    return;
  end if;

  if v_attempts >= p_max_attempts then
    update public.channel_sync_jobs
       set status = 'failed', last_error = left(coalesce(p_error, 'unknown error'), 500)
     where id = p_job_id;
    return;
  end if;

  -- 30s, 60s, 120s, 240s, 480s ... capped at 15 minutes.
  v_backoff := least(power(2, greatest(v_attempts - 1, 0)) * 30, 900) * interval '1 second';

  update public.channel_sync_jobs
     set status = 'queued',
         next_attempt_at = pg_catalog.now() + v_backoff,
         last_error = left(coalesce(p_error, 'unknown error'), 500)
   where id = p_job_id;
end;
$$;

/*
  Records the result of a successful stock push, so the admin can show what was
  last sent and when without inferring it from the log.
*/
create function public.mark_listing_pushed(p_listing_id uuid, p_qty integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.channel_listings
     set last_pushed_qty = p_qty, last_pushed_at = pg_catalog.now()
   where id = p_listing_id;
$$;

/*
  All three of public, anon and authenticated. Granting without revoking permits
  nothing new — that is exactly how the Phase 7 loyalty reads ended up
  world-readable (20260803064500).
*/
revoke all on function public.claim_sync_jobs(integer, sales_channel[]) from public, anon, authenticated;
revoke all on function public.release_sync_job(uuid, boolean, text, integer)  from public, anon, authenticated;
revoke all on function public.mark_listing_pushed(uuid, integer)              from public, anon, authenticated;
grant execute on function public.claim_sync_jobs(integer, sales_channel[]) to service_role;
grant execute on function public.release_sync_job(uuid, boolean, text, integer)  to service_role;
grant execute on function public.mark_listing_pushed(uuid, integer)              to service_role;
