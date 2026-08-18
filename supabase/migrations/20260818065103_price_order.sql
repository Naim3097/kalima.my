/*
  ONE implementation of the price.

  The charge was computed here in SQL and the quote was computed again in
  TypeScript, so the checkout could show a shopper one total and bill another —
  not through a bug anyone could see, but the moment either side was edited
  without the other. They agreed only because they were written together.

  price_order() is now the only place the rules live. create_order calls it and
  inserts the answer; the checkout calls it through quoteOrder() and renders the
  answer. Neither recomputes a figure, so they cannot disagree.

  WHAT STAYS IN create_order: the stock gate and its customer-facing raises.
  Being sold out is not a pricing fact, and a quote must be able to price a bag
  that is about to fail for other reasons. That loop re-reads the variants this
  one reads — a few extra queries, deliberately, to keep the RULES in one place
  rather than the QUERIES.

  WHAT IS NOT HERE: points EARNED. That is a forecast of a future award rather
  than part of what the customer pays, and it is the one number where a
  mismatch between preview and reality costs nobody anything.
*/
create or replace function public.price_order(
  p_user_id uuid,
  p_items jsonb,
  p_discount_code text default null,
  p_redeem_points integer default 0
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  item jsonb; v public.product_variants; p public.products;
  unit_price integer; line_qty integer;
  subtotal integer := 0; discount integer := 0; shipping integer := 0; tax integer := 0;
  free_ship boolean := false;
  applied_code text;
  cfg public.store_settings;
  promo public.signup_promo;
  first_order_sen integer := 0;
  rules public.loyalty_rules;
  balance integer := 0;
  redeem_pts integer := 0;
  loyalty_sen integer := 0;
  cap_sen integer;
  disc jsonb;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'cart is empty'; end if;

  select * into cfg from public.store_settings where id = 1;

  for item in select * from jsonb_array_elements(p_items) loop
    line_qty := (item ->> 'qty')::integer;
    if line_qty is null or line_qty <= 0 then raise exception 'invalid quantity'; end if;
    select * into v from public.product_variants where id = (item ->> 'variant_id')::uuid;
    if not found then raise exception 'variant % not found', item ->> 'variant_id'; end if;
    select * into p from public.products where id = v.product_id;
    if not p.published then raise exception 'product % is not available', p.name; end if;

    -- Variant override, else the product's sale price, else its list price.
    unit_price := coalesce(v.price_sen, p.sale_price_sen, p.price_sen);
    subtotal := subtotal + unit_price * line_qty;
  end loop;

  if p_discount_code is not null and trim(p_discount_code) <> '' then
    disc := public.validate_discount(p_discount_code, subtotal);
    if (disc ->> 'valid')::boolean then
      discount := (disc ->> 'discount_sen')::integer;
      free_ship := coalesce((disc ->> 'free_shipping')::boolean, false);
      if discount > 0 or free_ship then applied_code := trim(p_discount_code); end if;
    end if;
  end if;

  /*
    New-member discount. Signed in, the shop is running one, no code in play —
    and not already held by another order of theirs.

    That last clause is the fix for a real hole: eligibility used to ask only
    about purchase HISTORY, so a member could place an order, abandon it at the
    payment step, place a second, and pay both — taking the discount twice. A
    pending order is neither a purchase nor nothing, and this is what says so.
    placeOrder cancels genuinely dead pending orders first, so an honest
    shopper who abandoned once is not the person this catches.
  */
  if p_user_id is not null and discount = 0 then
    select * into promo from public.signup_promo where id = 1;

    if promo.first_order_discount_sen > 0
       and not exists (
         select 1 from public.orders o
         where o.user_id = p_user_id
           and (
             o.status in ('paid', 'fulfilled', 'completed', 'refunded')
             or (o.first_order_discount_sen > 0 and o.status <> 'cancelled')
           )
       )
    then
      first_order_sen := least(promo.first_order_discount_sen, subtotal);
    end if;
  end if;

  /*
    Loyalty redemption. Guests have no balance, so this is a signed-in-only
    path. The amount is clamped by three independent limits — the customer's
    actual balance, the scheme's per-order ceiling, and what is left to pay —
    so no combination of inputs can produce a negative total or spend points
    that do not exist.
  */
  if p_redeem_points > 0 and p_user_id is not null then
    select * into rules from public.loyalty_rules where id = 1;

    if rules.enabled then
      balance := public.loyalty_balance(p_user_id);
      redeem_pts := least(p_redeem_points, balance);

      if redeem_pts < rules.min_redeem_points then
        redeem_pts := 0;
      else
        /* Ceiling: a percentage of the goods value, never of shipping or tax,
           and never of money already taken off by the new-member discount. */
        cap_sen := ((subtotal - discount - first_order_sen) * rules.max_redeem_bps) / 10000;
        loyalty_sen := least(
          redeem_pts * rules.sen_per_point, cap_sen, subtotal - discount - first_order_sen
        );
        -- Only charge the customer the points actually used.
        if rules.sen_per_point > 0 then
          redeem_pts := (loyalty_sen + rules.sen_per_point - 1) / rules.sen_per_point;
        end if;
        if loyalty_sen <= 0 then redeem_pts := 0; end if;
      end if;
    end if;
  end if;

  /*
    Shipping. A free-shipping code is an explicit grant and wins outright.
    Otherwise the threshold applies only when the shop has set one: zero means
    the promotion is off, so every order pays the flat rate.
  */
  if free_ship
     or (cfg.free_shipping_threshold_sen > 0
         and (subtotal - discount) >= cfg.free_shipping_threshold_sen) then
    shipping := 0;
  else
    shipping := cfg.flat_shipping_sen;
  end if;

  tax := round((subtotal - discount) * cfg.tax_rate_bps / 10000.0);

  return jsonb_build_object(
    'subtotal_sen', subtotal,
    'discount_sen', discount,
    'discount_code', applied_code,
    'first_order_discount_sen', first_order_sen,
    'loyalty_points_used', redeem_pts,
    'loyalty_discount_sen', loyalty_sen,
    'shipping_sen', shipping,
    'free_shipping', (shipping = 0),
    'tax_sen', tax,
    'total_sen', (subtotal - discount - first_order_sen - loyalty_sen + shipping + tax)
  );
end;
$function$;

/* Same lock as every other order function: reachable only through a server
   action running as service_role, never from a browser. */
revoke all on function public.price_order(uuid, jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.price_order(uuid, jsonb, text, integer) to service_role;

/*
  create_order now places the order and prices nothing. The stock gate stays,
  because it decides whether the sale can happen at all; every figure below it
  comes from price_order.
*/
create or replace function public.create_order(
  p_user_id uuid, p_items jsonb, p_email text, p_phone text, p_address jsonb,
  p_shipping_method text, p_discount_code text default null, p_redeem_points integer default 0
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

  /*
    Advisory stock gate. Not a reservation — the authoritative decision is the
    atomic decrement in mark_order_paid — but it stops a shopper paying for
    something that is already gone.
  */
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
  priced := public.price_order(p_user_id, p_items, p_discount_code, p_redeem_points);

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
    discount_code, shipping_method, shipping_address
  ) values (
    new_order_id, p_user_id, trim(p_email), p_phone, 'pending',
    subtotal, discount, shipping, tax,
    first_order_sen, redeem_pts, loyalty_sen, total,
    applied_code, p_shipping_method, p_address
  ) returning reference into new_reference;

  -- Burn the points in the SAME transaction as the order they paid for.
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

  /* Recorded against the code price_order actually applied, not the string the
     caller sent — an invalid code leaves no redemption behind. */
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
    'first_order_discount_sen', first_order_sen,
    'loyalty_points_used', redeem_pts, 'loyalty_discount_sen', loyalty_sen
  );
end;
$function$;
