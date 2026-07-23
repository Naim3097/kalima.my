/*
  Fix: points must not be earned on the part of an order paid WITH points.

  award_loyalty_points computed its base as (subtotal - discount), ignoring
  loyalty_discount_sen. A customer could therefore redeem points, earn points on
  the redeemed portion, and feed the result back in — a slow but real
  points-farming loop, and the checkout preview (which already excluded it)
  would have disagreed with what was actually awarded.

  Earning now applies only to money actually paid for goods.
*/
create or replace function public.award_loyalty_points(p_order_id uuid)
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

  /*
    Earn on money actually paid for goods: shipping and tax are pass-through,
    and the points-funded portion is not spend at all.
  */
  base := greatest(o.subtotal_sen - o.discount_sen - o.loyalty_discount_sen, 0);
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

revoke all on function public.award_loyalty_points(uuid) from public, anon, authenticated;
grant execute on function public.award_loyalty_points(uuid) to service_role;
