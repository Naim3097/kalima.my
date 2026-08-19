/*
  create_order carries the quote through, and records what was actually quoted.

  It takes p_quote_id + p_service_id in place of p_chosen_shipping_sen, hands
  them to price_order, and stores the service NAME and COURIER that came back
  from the frozen quote — not from its own arguments. So the order cannot be
  labelled with a courier the customer never saw, any more than it can be
  priced at a figure they never agreed to.
*/
create or replace function public.create_order(
  p_user_id uuid, p_items jsonb, p_email text, p_phone text, p_address jsonb,
  p_shipping_method text, p_discount_code text default null, p_redeem_points integer default 0,
  p_quote_id uuid default null, p_service_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  item jsonb; v public.product_variants; p public.products;
  unit_price integer; line_qty integer;
  priced jsonb;
  subtotal integer; discount integer; first_order_sen integer;
  redeem_pts integer; loyalty_sen integer; shipping integer; tax integer; total integer;
  applied_code text;
  new_order_id uuid; new_reference text; disc_id uuid;
begin
  if p_email is null or trim(p_email) = '' then raise exception 'email is required'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'cart is empty'; end if;

  new_order_id := gen_random_uuid();

  /* Advisory stock gate. Not a reservation — the authoritative decision is the
     atomic decrement in mark_order_paid — but it stops a shopper paying for
     something that is already gone. */
  for item in select * from jsonb_array_elements(p_items) loop
    line_qty := (item ->> 'qty')::integer;
    if line_qty is null or line_qty <= 0 then raise exception 'invalid quantity'; end if;
    select * into v from public.product_variants where id = (item ->> 'variant_id')::uuid;
    if not found then raise exception 'variant % not found', item ->> 'variant_id'; end if;
    select * into p from public.products where id = v.product_id;
    if not p.published then raise exception 'product % is not available', p.name; end if;

    if v.stock_on_hand < line_qty then
      if v.stock_on_hand <= 0 then
        raise exception '% (% · %) is sold out', p.name, v.color_name, v.size;
      else
        raise exception 'Only % left of % (% · %)', v.stock_on_hand, p.name, v.color_name, v.size;
      end if;
    end if;
  end loop;

  -- Every figure on the order comes from here, and from nowhere else.
  priced := public.price_order(
    p_user_id, p_items, p_discount_code, p_redeem_points,
    coalesce(p_address ->> 'country', 'MY'),
    p_address ->> 'state',
    p_quote_id, p_service_id
  );

  if (priced ->> 'requires_shipping_selection')::boolean then
    raise exception 'Choose a delivery service before placing this order.';
  end if;

  subtotal        := (priced ->> 'subtotal_sen')::integer;
  discount        := (priced ->> 'discount_sen')::integer;
  applied_code    := priced ->> 'discount_code';
  first_order_sen := (priced ->> 'first_order_discount_sen')::integer;
  redeem_pts      := (priced ->> 'loyalty_points_used')::integer;
  loyalty_sen     := (priced ->> 'loyalty_discount_sen')::integer;
  shipping        := (priced ->> 'shipping_sen')::integer;
  tax             := (priced ->> 'tax_sen')::integer;
  total           := (priced ->> 'total_sen')::integer;

  insert into public.orders (
    id, user_id, email, phone, status, subtotal_sen, discount_sen, shipping_sen, tax_sen,
    first_order_discount_sen, loyalty_points_redeemed, loyalty_discount_sen, total_sen,
    discount_code, shipping_method, shipping_address,
    shipping_quote_id, shipping_service_id, shipping_service_name, shipping_courier
  ) values (
    new_order_id, p_user_id, trim(p_email), p_phone, 'pending',
    subtotal, discount, shipping, tax,
    first_order_sen, redeem_pts, loyalty_sen, total,
    applied_code, p_shipping_method, p_address,
    p_quote_id, p_service_id,
    priced ->> 'shipping_service_name',
    priced ->> 'shipping_courier'
  ) returning reference into new_reference;

  if redeem_pts > 0 then
    insert into public.loyalty_ledger (user_id, order_id, type, points, reason)
    values (p_user_id, new_order_id, 'redeem', -redeem_pts,
            'redeemed on order ' || new_reference);
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    line_qty := (item ->> 'qty')::integer;
    select * into v from public.product_variants where id = (item ->> 'variant_id')::uuid;
    select * into p from public.products where id = v.product_id;
    unit_price := coalesce(v.price_sen, p.sale_price_sen, p.price_sen);
    insert into public.order_items (
      order_id, product_variant_id, product_name, variant_sku,
      color_name, size, unit_price_sen, qty, line_total_sen
    ) values (
      new_order_id, v.id, p.name, v.sku, v.color_name, v.size,
      unit_price, line_qty, unit_price * line_qty
    );
  end loop;

  if applied_code is not null then
    select id into disc_id from public.discount_codes where upper(code) = upper(applied_code);
    if disc_id is not null then
      insert into public.discount_redemptions (discount_code_id, order_id, user_id)
      values (disc_id, new_order_id, p_user_id);
    end if;
  end if;

  return jsonb_build_object(
    'order_id', new_order_id, 'reference', new_reference,
    'total_sen', total,
    'shipping_sen', shipping,
    'shipping_zone', priced ->> 'shipping_zone',
    'shipping_courier', priced ->> 'shipping_courier',
    'first_order_discount_sen', first_order_sen,
    'loyalty_points_used', redeem_pts, 'loyalty_discount_sen', loyalty_sen
  );
end;
$function$;

/* The price-taking form is removed for the same reason as price_order's. */
drop function if exists public.create_order(uuid, jsonb, text, text, jsonb, text, text, integer, integer);
