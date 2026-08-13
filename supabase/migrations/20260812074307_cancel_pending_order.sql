/*
  Cancel a still-pending order. Idempotent, and only ever touches a pending
  one: a paid, cancelled or refunded order is returned untouched with its
  status, so a late caller can never undo a settled sale.

  No stock is returned because none was held — the decrement lives only in
  mark_order_paid, so a pending order reserves nothing. This is bookkeeping:
  it clears an abandoned checkout out of the pending set so reporting is honest
  and the order list is not clogged.

  Locked to service_role, like every other function that moves an order's
  state; the expiry route calls it with the admin client.
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
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if o.status <> 'pending' then
    -- Already settled or already cancelled — leave it exactly as it is.
    return jsonb_build_object('status', o.status, 'reference', o.reference, 'noop', true);
  end if;

  update public.orders
    set status = 'cancelled',
        cancelled_at = now()
    where id = p_order_id;

  -- Give back any loyalty points the pending order had burned, so an abandoned
  -- checkout does not quietly cost the customer their balance.
  update public.loyalty_ledger
    set type = 'refund', reason = 'order ' || o.reference || ' cancelled: ' || p_reason
    where order_id = p_order_id and type = 'redeem';

  return jsonb_build_object('status', 'cancelled', 'reference', o.reference);
end;
$$;

revoke all on function public.cancel_pending_order(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_pending_order(uuid, text) to service_role;
