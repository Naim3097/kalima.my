/*
  Loyalty engine.

  Balance is always computed from the ledger — there is no cached total to go
  stale. Expiry is applied as a read-time filter rather than a nightly job, so
  a balance is correct the moment it is read even if no sweeper has run.
*/

/** Unexpired point balance for a customer. */
create function public.loyalty_balance(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(points), 0)::integer
    from public.loyalty_ledger
   where user_id = p_user_id
     and (expires_at is null or expires_at > pg_catalog.now());
$$;

/*
  A customer's tier, from qualifying spend over the last 12 months.

  Recomputed on read rather than stored, so a tier can never be stale after a
  refund. Refunded and cancelled orders are excluded — a sale that came back
  should not keep buying status.
*/
create function public.customer_tier(p_user_id uuid)
returns public.membership_tiers
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  spend integer;
  t public.membership_tiers;
begin
  select coalesce(sum(o.total_sen), 0)::integer into spend
    from public.orders o
   where o.user_id = p_user_id
     and o.status in ('paid', 'fulfilled', 'completed')
     and o.created_at > pg_catalog.now() - interval '12 months';

  select * into t from public.membership_tiers
   where min_spend_sen <= spend
   order by min_spend_sen desc
   limit 1;

  return t;
end;
$$;

/*
  Awards points for a completed order.

  Earned on COMPLETION, not payment: points for goods still inside the return
  window are a liability the shop may have to unwind. The unique index on
  (order_id) where type='earn' makes a replayed completion a no-op.

  Guest orders earn nothing — points need an account to live on.
*/
create function public.award_loyalty_points(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o      public.orders;
  rules  public.loyalty_rules;
  tier   public.membership_tiers;
  base   integer;
  pts    integer;
begin
  select * into o from public.orders where id = p_order_id;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;

  select * into rules from public.loyalty_rules where id = 1;
  if not rules.enabled then
    return jsonb_build_object('awarded', false, 'reason', 'loyalty disabled');
  end if;

  if o.user_id is null then
    return jsonb_build_object('awarded', false, 'reason', 'guest order');
  end if;

  if o.status <> 'completed' then
    return jsonb_build_object('awarded', false, 'reason', 'order not completed');
  end if;

  if exists (select 1 from public.loyalty_ledger l
              where l.order_id = p_order_id and l.type = 'earn') then
    return jsonb_build_object('awarded', false, 'reason', 'already awarded');
  end if;

  -- Points earn on goods after discount: shipping and tax are pass-through.
  base := greatest(o.subtotal_sen - o.discount_sen, 0);
  select * into tier from public.customer_tier(o.user_id);

  pts := ((base / 100) * rules.points_per_rm * coalesce(tier.multiplier_bps, 10000)) / 10000;

  if pts <= 0 then
    return jsonb_build_object('awarded', false, 'reason', 'no points for this order');
  end if;

  insert into public.loyalty_ledger (user_id, order_id, type, points, reason, expires_at)
  values (
    o.user_id, p_order_id, 'earn', pts,
    'order ' || o.reference || coalesce(' · ' || tier.name, ''),
    pg_catalog.now() + (rules.expiry_months || ' months')::interval
  );

  return jsonb_build_object(
    'awarded', true, 'points', pts,
    'tier', coalesce(tier.name, 'Member'),
    'balance', public.loyalty_balance(o.user_id)
  );
end;
$$;

/*
  Reverses an order's points when it is refunded.

  Deducts what was actually awarded rather than recomputing, because the rules
  or the customer's tier may have changed since. Balance is allowed to go
  negative: the alternative is letting someone refund their way to free points.
*/
create function public.revoke_loyalty_points(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare e public.loyalty_ledger;
begin
  select * into e from public.loyalty_ledger
   where order_id = p_order_id and type = 'earn';
  if not found then
    return jsonb_build_object('revoked', false, 'reason', 'nothing awarded');
  end if;

  if exists (select 1 from public.loyalty_ledger l
              where l.order_id = p_order_id and l.type = 'adjust' and l.points < 0) then
    return jsonb_build_object('revoked', false, 'reason', 'already revoked');
  end if;

  insert into public.loyalty_ledger (user_id, order_id, type, points, reason)
  values (e.user_id, p_order_id, 'adjust', -e.points, 'order refunded');

  return jsonb_build_object('revoked', true, 'points', -e.points);
end;
$$;

revoke all on function public.award_loyalty_points(uuid)  from public, anon, authenticated;
revoke all on function public.revoke_loyalty_points(uuid) from public, anon, authenticated;
grant execute on function public.award_loyalty_points(uuid)  to service_role;
grant execute on function public.revoke_loyalty_points(uuid) to service_role;
-- Balance and tier are safe to read for one's own account.
grant execute on function public.loyalty_balance(uuid) to authenticated, service_role;
grant execute on function public.customer_tier(uuid)   to authenticated, service_role;
