/*
  Phase 3 — refunds.

  LeanX exposes no refund API (the integration guide documents only
  create-bill-silent, list-payment-services and transaction-status), so the
  money itself is moved in the LeanX dashboard. What was missing here is
  everything that should happen on OUR side when it is:

  - stock was never returned. Marking an order 'refunded' only changed a label,
    so every refund permanently understated inventory.
  - the payment row kept saying 'paid'.
  - there was no record of how much came back, or when.

  Goods go back through the stock_movements ledger as a 'release' — never a
  bare update — so inventory stays fully auditable.

  Idempotent: a second call (a retried webhook, a double click) returns
  already_refunded without restocking twice. service_role only.
*/
alter table orders add column refunded_at  timestamptz;
alter table orders add column refunded_sen integer not null default 0 check (refunded_sen >= 0);

create function public.refund_order(
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

  -- Idempotency: retried webhooks and double clicks must not restock twice.
  if o.status = 'refunded' then
    return jsonb_build_object('status', 'already_refunded', 'reference', o.reference);
  end if;

  if o.status not in ('paid', 'fulfilled', 'completed') then
    raise exception 'order % is % — only a settled order can be refunded', o.reference, o.status;
  end if;

  if p_amount_sen < 0 or p_amount_sen > o.total_sen then
    raise exception 'refund of % is outside the order total %', p_amount_sen, o.total_sen;
  end if;

  -- Goods come back through the ledger, exactly like any other stock change.
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

  return jsonb_build_object(
    'status', 'refunded', 'reference', o.reference,
    'restocked', p_restock, 'amount_sen', p_amount_sen
  );
end;
$$;

revoke all on function public.refund_order(uuid, integer, boolean, text) from public, anon, authenticated;
grant execute on function public.refund_order(uuid, integer, boolean, text) to service_role;
