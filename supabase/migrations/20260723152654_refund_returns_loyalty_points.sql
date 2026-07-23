/*
  Fix: refunding an order must also reverse its loyalty points.

  Points reversal was wired into the admin refund ACTION, but refund_order is
  the real money path and is also reached from the LeanX refund webhook. A
  gateway-initiated refund therefore returned the stock and clawed back the
  commission while silently destroying the points the customer had spent.

  Stock, commission and points now all reverse inside the one function, so
  every refund path behaves identically no matter who triggered it.
*/
create or replace function public.refund_order(
  p_order_id   uuid,
  p_amount_sen integer,
  p_restock    boolean default true,
  p_reason     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o  public.orders;
  it public.order_items;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;

  if o.status = 'refunded' then
    return jsonb_build_object('status', 'already_refunded', 'reference', o.reference);
  end if;

  if o.status not in ('paid', 'fulfilled', 'completed') then
    raise exception 'order % is % — only a settled order can be refunded', o.reference, o.status;
  end if;

  if p_amount_sen < 0 or p_amount_sen > o.total_sen then
    raise exception 'refund of % is outside the order total %', p_amount_sen, o.total_sen;
  end if;

  if p_restock then
    for it in select * from public.order_items where order_id = p_order_id loop
      update public.product_variants
        set stock_on_hand = stock_on_hand + it.qty
        where id = it.product_variant_id;

      insert into public.stock_movements (product_variant_id, type, qty_delta, order_id, reason)
      values (
        it.product_variant_id, 'release', it.qty, p_order_id,
        'refund ' || o.reference || coalesce(' — ' || nullif(trim(p_reason), ''), '')
      );
    end loop;
  end if;

  update public.orders
    set status = 'refunded', refunded_at = pg_catalog.now(), refunded_sen = p_amount_sen
    where id = p_order_id;

  update public.payments
    set status = 'refunded', updated_at = pg_catalog.now()
    where order_id = p_order_id;

  -- Commission dies with the sale.
  perform public.clawback_referral(p_order_id);
  -- Points earned are reversed; points SPENT are handed back.
  perform public.revoke_loyalty_points(p_order_id);

  return jsonb_build_object(
    'status', 'refunded', 'reference', o.reference,
    'restocked', p_restock, 'amount_sen', p_amount_sen
  );
end;
$$;

revoke all on function public.refund_order(uuid, integer, boolean, text) from public, anon, authenticated;
grant execute on function public.refund_order(uuid, integer, boolean, text) to service_role;
