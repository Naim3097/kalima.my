/*
  Cancel a still-pending order. Idempotent; only ever touches a pending one, so
  a late caller can never undo a settled sale. No stock is returned because none
  was held (the decrement lives only in mark_order_paid). Any loyalty points the
  pending order burned are given back as a compensating 'adjust' entry, so an
  abandoned checkout never quietly costs the customer their balance.

  Locked to service_role, like every other order-state function.
*/
create or replace function public.cancel_pending_order(
  p_order_id uuid,
  p_reason text default 'expired unpaid'
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  o public.orders;
  burned integer;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if o.status <> 'pending' then
    return jsonb_build_object('status', o.status, 'reference', o.reference, 'noop', true);
  end if;

  update public.orders
    set status = 'cancelled', cancelled_at = pg_catalog.now(), updated_at = pg_catalog.now()
    where id = p_order_id;

  /*
    Return redeemed points. The redeem entry carries negative points; sum them
    and post an equal positive 'adjust' (the enum has no 'refund'), so
    loyalty_balance — which sums points — comes back whole. Only for a signed-in
    order that actually spent points.
  */
  if o.user_id is not null and coalesce(o.loyalty_points_redeemed, 0) > 0 then
    select coalesce(sum(points), 0) into burned
      from public.loyalty_ledger where order_id = p_order_id and type = 'redeem';
    if burned < 0 then
      insert into public.loyalty_ledger (user_id, order_id, type, points, reason)
      values (o.user_id, p_order_id, 'adjust', -burned,
              'points returned: order ' || o.reference || ' cancelled (' || p_reason || ')');
    end if;
  end if;

  return jsonb_build_object('status', 'cancelled', 'reference', o.reference);
end;
$$;

revoke all on function public.cancel_pending_order(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_pending_order(uuid, text) to service_role;
