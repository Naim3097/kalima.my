/*
  Phase 7 — redeeming points at checkout.

  This changes the money path, so it is done INSIDE create_order's transaction
  rather than as a follow-up call. That is the whole point: if the order fails
  to insert, the points are not spent; if it succeeds, they cannot be spent
  twice. A separate "burn points" call either leaks points on failure or
  double-spends on retry.

  Everything about the discount is computed server-side from the ledger. The
  caller says how many points to use; it never says what they are worth.
*/

alter table orders add column loyalty_points_redeemed integer not null default 0
  check (loyalty_points_redeemed >= 0);
alter table orders add column loyalty_discount_sen integer not null default 0
  check (loyalty_discount_sen >= 0);

create or replace function public.create_order(
  p_user_id uuid, p_items jsonb, p_email text, p_phone text,
  p_address jsonb, p_shipping_method text, p_discount_code text default null,
  p_redeem_points integer default 0
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item jsonb; v public.product_variants; p public.products;
  unit_price integer; line_qty integer;
  subtotal integer := 0; discount integer := 0; shipping integer := 0; tax integer := 0;
  free_ship boolean := false;
  cfg public.store_settings;
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
    unit_price := coalesce(v.price_sen, p.price_sen);
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
        -- Ceiling: a percentage of the goods value, never of shipping or tax.
        cap_sen := ((subtotal - discount) * rules.max_redeem_bps) / 10000;
        loyalty_sen := least(redeem_pts * rules.sen_per_point, cap_sen, subtotal - discount);
        -- Only charge the customer the points actually used.
        if rules.sen_per_point > 0 then
          redeem_pts := (loyalty_sen + rules.sen_per_point - 1) / rules.sen_per_point;
        end if;
        if loyalty_sen <= 0 then redeem_pts := 0; end if;
      end if;
    end if;
  end if;

  if (subtotal - discount) >= cfg.free_shipping_threshold_sen or free_ship then
    shipping := 0;
  else
    shipping := cfg.flat_shipping_sen;
  end if;

  tax := round((subtotal - discount) * cfg.tax_rate_bps / 10000.0);

  insert into public.orders (
    id, user_id, email, phone, status, subtotal_sen, discount_sen, shipping_sen, tax_sen,
    loyalty_points_redeemed, loyalty_discount_sen, total_sen,
    discount_code, shipping_method, shipping_address
  ) values (
    new_order_id, p_user_id, trim(p_email), p_phone, 'pending',
    subtotal, discount, shipping, tax,
    redeem_pts, loyalty_sen,
    (subtotal - discount - loyalty_sen + shipping + tax),
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
    unit_price := coalesce(v.price_sen, p.price_sen);
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
    'total_sen', (subtotal - discount - loyalty_sen + shipping + tax),
    'loyalty_points_used', redeem_pts, 'loyalty_discount_sen', loyalty_sen
  );
end;
$$;

revoke all on function public.create_order(uuid, jsonb, text, text, jsonb, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.create_order(uuid, jsonb, text, text, jsonb, text, text, integer)
  to service_role;

/*
  Refunding gives back points that were SPENT on the order, as well as
  reversing points earned by it. Without this a refunded order silently
  destroys the customer's points.
*/
create or replace function public.revoke_loyalty_points(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  earned public.loyalty_ledger;
  spent  public.loyalty_ledger;
  gave_back integer := 0;
  took_back integer := 0;
begin
  -- Reverse points EARNED by this order.
  select * into earned from public.loyalty_ledger
   where order_id = p_order_id and type = 'earn';
  if found and not exists (
    select 1 from public.loyalty_ledger l
     where l.order_id = p_order_id and l.type = 'adjust' and l.points < 0
  ) then
    insert into public.loyalty_ledger (user_id, order_id, type, points, reason)
    values (earned.user_id, p_order_id, 'adjust', -earned.points, 'order refunded');
    took_back := earned.points;
  end if;

  -- Return points SPENT on this order.
  select * into spent from public.loyalty_ledger
   where order_id = p_order_id and type = 'redeem';
  if found and not exists (
    select 1 from public.loyalty_ledger l
     where l.order_id = p_order_id and l.type = 'adjust' and l.points > 0
  ) then
    insert into public.loyalty_ledger (user_id, order_id, type, points, reason)
    values (spent.user_id, p_order_id, 'adjust', -spent.points, 'points returned — order refunded');
    gave_back := -spent.points;
  end if;

  return jsonb_build_object(
    'revoked', (took_back > 0 or gave_back > 0),
    'earned_reversed', took_back, 'spent_returned', gave_back
  );
end;
$$;

revoke all on function public.revoke_loyalty_points(uuid) from public, anon, authenticated;
grant execute on function public.revoke_loyalty_points(uuid) to service_role;
