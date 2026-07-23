/*
  Attribution and clawback.

  attribute_referral runs when an order becomes PAID — never at checkout, so an
  abandoned or failed order never creates a commission.

  Fraud guards, all enforced here rather than in the UI:
  - SELF-PURCHASE: an affiliate buying through their own code or link earns
    nothing. Matched on user_id and on email, because logging out is not a
    loophole.
  - ONE PER ORDER: unique(order_id) means the code path and the link path can
    never both pay for the same sale. An explicit code wins over an ambient
    cookie.
  - HOLD PERIOD: commission is not payable until the return window closes, so a
    refund lands before the money goes out rather than after.
  - APPROVED ONLY: a pending or suspended affiliate accrues nothing.

  Commission is computed from the ORDER, never from anything a caller passes.
*/
create function public.attribute_referral(
  p_order_id   uuid,
  p_hold_days  integer default 14
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o          public.orders;
  aff        public.affiliates;
  base       integer;
  commission integer;
  src        text;
begin
  select * into o from public.orders where id = p_order_id;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;

  -- Only a settled order earns commission.
  if o.status not in ('paid', 'fulfilled', 'completed') then
    return jsonb_build_object('attributed', false, 'reason', 'order not settled');
  end if;

  -- Already attributed (webhook retry, manual re-run) — idempotent.
  if exists (select 1 from public.affiliate_referrals r where r.order_id = p_order_id) then
    return jsonb_build_object('attributed', false, 'reason', 'already attributed');
  end if;

  -- Path 1: an explicit affiliate discount code beats an ambient cookie.
  if o.discount_code is not null and trim(o.discount_code) <> '' then
    select * into aff from public.affiliates
     where upper(discount_code) = upper(trim(o.discount_code)) and status = 'approved';
    if found then src := 'code'; end if;
  end if;

  -- Path 2: the ?ref link captured at checkout.
  if aff.id is null and o.affiliate_ref is not null and trim(o.affiliate_ref) <> '' then
    select * into aff from public.affiliates
     where slug = lower(trim(o.affiliate_ref)) and status = 'approved';
    if found then src := 'link'; end if;
  end if;

  if aff.id is null then
    return jsonb_build_object('attributed', false, 'reason', 'no approved affiliate matched');
  end if;

  -- Self-purchase: matched on account AND on email, so signing out is not a way around it.
  if (aff.user_id is not null and o.user_id is not null and aff.user_id = o.user_id)
     or lower(aff.email) = lower(o.email) then
    return jsonb_build_object('attributed', false, 'reason', 'self purchase');
  end if;

  -- Commission earns on goods only: shipping and tax are pass-through, not margin.
  base := greatest(o.subtotal_sen - o.discount_sen, 0);
  commission := (base * aff.commission_bps) / 10000;

  insert into public.affiliate_referrals (
    affiliate_id, order_id, base_sen, commission_sen, commission_bps, source, status, hold_until
  ) values (
    aff.id, p_order_id, base, commission, aff.commission_bps, src, 'pending',
    pg_catalog.now() + (p_hold_days || ' days')::interval
  );

  return jsonb_build_object(
    'attributed', true, 'affiliate_id', aff.id,
    'commission_sen', commission, 'source', src
  );
end;
$$;

/*
  Clawback. A refunded or cancelled order must not pay commission — and if it
  was already paid out, the row is still marked so the balance is honest and
  staff can recover it against the next payout.
*/
create function public.clawback_referral(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare r public.affiliate_referrals;
begin
  select * into r from public.affiliate_referrals where order_id = p_order_id;
  if not found then
    return jsonb_build_object('clawed_back', false, 'reason', 'no referral');
  end if;
  if r.status = 'clawed_back' then
    return jsonb_build_object('clawed_back', false, 'reason', 'already clawed back');
  end if;

  update public.affiliate_referrals
     set status = 'clawed_back'
   where id = r.id;

  return jsonb_build_object(
    'clawed_back', true, 'was_paid', (r.status = 'paid'),
    'commission_sen', r.commission_sen
  );
end;
$$;

revoke all on function public.attribute_referral(uuid, integer) from public, anon, authenticated;
grant execute on function public.attribute_referral(uuid, integer) to service_role;
revoke all on function public.clawback_referral(uuid) from public, anon, authenticated;
grant execute on function public.clawback_referral(uuid) to service_role;

/*
  Refunding an order now also claws back its commission. Extends the existing
  refund_order rather than adding a second path a caller could forget to use.
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

  return jsonb_build_object(
    'status', 'refunded', 'reference', o.reference,
    'restocked', p_restock, 'amount_sen', p_amount_sen
  );
end;
$$;

revoke all on function public.refund_order(uuid, integer, boolean, text) from public, anon, authenticated;
grant execute on function public.refund_order(uuid, integer, boolean, text) to service_role;
