/*
  The new-member discount, applied automatically to a first purchase.

  WHY THERE IS NO CODE. A code is a bearer token: it gets pasted into group
  chats and used by everyone, including the customers who have already bought.
  The thing the shop actually wants to reward is "this member has never bought
  from us", which is a fact the database already holds. So the rule is computed
  at order time from the customer's own history and cannot be shared, guessed
  or replayed.

  ELIGIBLE = signed in, AND no previous order that ever became a purchase.

  "Ever became a purchase" is paid, fulfilled, completed or refunded. Refunded
  counts deliberately: they did buy, the money came back for a reason of its
  own, and that is not a second first order. Pending and cancelled do NOT count
  — an abandoned checkout leaves a pending order behind, and holding that
  against someone would quietly withdraw the offer from the very people it is
  meant to bring back.

  KNOWN EDGE, stated rather than hidden: two checkouts started before either is
  paid are both eligible at the moment they are created, so a determined
  customer can take the discount twice. Closing that needs a reservation across
  pending orders, which costs every honest shopper a worse checkout to stop a
  rare RM10. Revisit if it is ever seen in the orders table.

  GUESTS GET NOTHING here, which is the point: the offer is what membership is
  for, and p_user_id is only set for a signed-in shopper.

  It does NOT stack with a discount code. A code is a deliberate grant from the
  shop, and someone who has been given one should not silently receive the
  new-member money on top; the larger of the two is not chosen either, because
  a customer who typed a code expects to see that code applied.
*/

/*
  Recorded in its own column rather than folded into discount_sen, so the
  confirmation email, the admin order view and any later report can all tell
  "we gave a new member RM10" apart from "they used a code" — exactly as
  loyalty_discount_sen is already kept separate.
*/
alter table orders
  add column first_order_discount_sen integer not null default 0
  check (first_order_discount_sen >= 0);

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
  subtotal integer := 0; discount integer := 0; shipping integer := 0; tax integer := 0;
  free_ship boolean := false;
  cfg public.store_settings;
  promo public.signup_promo;
  first_order_sen integer := 0;
  rules public.loyalty_rules;
  balance integer := 0;
  redeem_pts integer := 0;
  loyalty_sen integer := 0;
  cap_sen integer;
  new_order_id uuid; new_reference text; disc jsonb; disc_id uuid;
begin
  if p_email is null or trim(p_email) = '' then raise exception 'email is required'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'cart is empty'; end if;

  select * into cfg from public.store_settings where id = 1;
  new_order_id := gen_random_uuid();

  for item in select * from jsonb_array_elements(p_items) loop
    line_qty := (item ->> 'qty')::integer;
    if line_qty is null or line_qty <= 0 then raise exception 'invalid quantity'; end if;
    select * into v from public.product_variants where id = (item ->> 'variant_id')::uuid;
    if not found then raise exception 'variant % not found', item ->> 'variant_id'; end if;
    select * into p from public.products where id = v.product_id;
    if not p.published then raise exception 'product % is not available', p.name; end if;

    /*
      Advisory stock gate. Not a reservation — the authoritative decision is
      the atomic decrement in mark_order_paid — but it stops a shopper paying
      for something that is already gone.
    */
    if v.stock_on_hand < line_qty then
      if v.stock_on_hand <= 0 then
        raise exception '% (% · %) is sold out', p.name, v.color_name, v.size;
      else
        raise exception 'Only % left of % (% · %)', v.stock_on_hand, p.name, v.color_name, v.size;
      end if;
    end if;

    -- Variant override, else the product's sale price, else its list price.
    unit_price := coalesce(v.price_sen, p.sale_price_sen, p.price_sen);
    subtotal := subtotal + unit_price * line_qty;
  end loop;

  if p_discount_code is not null and trim(p_discount_code) <> '' then
    disc := public.validate_discount(p_discount_code, subtotal);
    if (disc ->> 'valid')::boolean then
      discount := (disc ->> 'discount_sen')::integer;
      free_ship := coalesce((disc ->> 'free_shipping')::boolean, false);
    end if;
  end if;

  /*
    New-member discount. Only for a signed-in shopper with no purchase behind
    them, only when the shop has set an amount, and never alongside a code.
    Clamped to what is left of the goods so it can never invert a total.
  */
  if p_user_id is not null and discount = 0 then
    select * into promo from public.signup_promo where id = 1;

    if promo.first_order_discount_sen > 0
       and not exists (
         select 1 from public.orders o
         where o.user_id = p_user_id
           and o.status in ('paid', 'fulfilled', 'completed', 'refunded')
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

  insert into public.orders (
    id, user_id, email, phone, status, subtotal_sen, discount_sen, shipping_sen, tax_sen,
    first_order_discount_sen, loyalty_points_redeemed, loyalty_discount_sen, total_sen,
    discount_code, shipping_method, shipping_address
  ) values (
    new_order_id, p_user_id, trim(p_email), p_phone, 'pending',
    subtotal, discount, shipping, tax,
    first_order_sen, redeem_pts, loyalty_sen,
    (subtotal - discount - first_order_sen - loyalty_sen + shipping + tax),
    case when discount > 0 or free_ship then p_discount_code end, p_shipping_method, p_address
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

  if (disc ->> 'valid')::boolean is true then
    select id into disc_id from public.discount_codes where upper(code) = upper(trim(p_discount_code));
    insert into public.discount_redemptions (discount_code_id, order_id, user_id)
    values (disc_id, new_order_id, p_user_id);
  end if;

  return jsonb_build_object(
    'order_id', new_order_id, 'reference', new_reference,
    'total_sen', (subtotal - discount - first_order_sen - loyalty_sen + shipping + tax),
    'first_order_discount_sen', first_order_sen,
    'loyalty_points_used', redeem_pts, 'loyalty_discount_sen', loyalty_sen
  );
end;
$function$;
