/*
  price_order takes a QUOTE, not a price.

  p_chosen_shipping_sen is replaced by p_quote_id + p_service_id. The amount is
  read from shipping_quotes here, so no caller — server action or otherwise —
  can name its own shipping figure. An id that is unknown, expired, or does not
  contain the requested service simply finds nothing, and the function reports
  requires_shipping_selection exactly as it does when no quote was given at all.
  One refusal path, not two.

  The service NAME and COURIER come back from the frozen quote too, so
  create_order can label the order from what was quoted rather than from what
  the form said.
*/
create or replace function public.price_order(
  p_user_id uuid,
  p_items jsonb,
  p_discount_code text default null,
  p_redeem_points integer default 0,
  p_country text default 'MY',
  p_state text default null,
  p_quote_id uuid default null,
  p_service_id text default null
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
  zone text;
  requires_selection boolean := false;
  chosen_sen integer;
  chosen_service_name text;
  chosen_courier text;
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
  zone := public.shipping_zone(p_country, p_state);

  for item in select * from jsonb_array_elements(p_items) loop
    line_qty := (item ->> 'qty')::integer;
    if line_qty is null or line_qty <= 0 then raise exception 'invalid quantity'; end if;
    select * into v from public.product_variants where id = (item ->> 'variant_id')::uuid;
    if not found then raise exception 'variant % not found', item ->> 'variant_id'; end if;
    select * into p from public.products where id = v.product_id;
    if not p.published then raise exception 'product % is not available', p.name; end if;

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

  if p_redeem_points > 0 and p_user_id is not null then
    select * into rules from public.loyalty_rules where id = 1;

    if rules.enabled then
      balance := public.loyalty_balance(p_user_id);
      redeem_pts := least(p_redeem_points, balance);

      if redeem_pts < rules.min_redeem_points then
        redeem_pts := 0;
      else
        cap_sen := ((subtotal - discount - first_order_sen) * rules.max_redeem_bps) / 10000;
        loyalty_sen := least(
          redeem_pts * rules.sen_per_point, cap_sen, subtotal - discount - first_order_sen
        );
        if rules.sen_per_point > 0 then
          redeem_pts := (loyalty_sen + rules.sen_per_point - 1) / rules.sen_per_point;
        end if;
        if loyalty_sen <= 0 then redeem_pts := 0; end if;
      end if;
    end if;
  end if;

  /*
    Shipping. A free-shipping code is an explicit grant and wins in every zone.
    Malaysia pays its zone rate. Overseas pays the frozen price of the service
    the customer chose — and if that cannot be found, nothing is priced.
  */
  if free_ship then
    shipping := 0;
  elsif zone = 'overseas' then
    if p_quote_id is not null and p_service_id is not null then
      select (opt ->> 'amount_sen')::integer,
             opt ->> 'service_name',
             opt ->> 'courier'
        into chosen_sen, chosen_service_name, chosen_courier
        from public.shipping_quotes q,
             lateral jsonb_array_elements(q.options) opt
       where q.id = p_quote_id
         and q.expires_at > pg_catalog.now()
         and opt ->> 'service_id' = p_service_id
       limit 1;
    end if;

    if chosen_sen is null then
      /* Unknown, expired, or a service that was never in this quote. Not an
         error — the customer is simply asked to choose again. */
      requires_selection := true;
      shipping := 0;  -- not known yet, never free
    else
      shipping := greatest(chosen_sen, 0);
    end if;
  elsif cfg.free_shipping_threshold_sen > 0
        and (subtotal - discount) >= cfg.free_shipping_threshold_sen then
    shipping := 0;
  elsif zone = 'east' then
    shipping := cfg.shipping_east_sen;
  else
    shipping := cfg.shipping_west_sen;
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
    'shipping_zone', zone,
    'shipping_service_name', chosen_service_name,
    'shipping_courier', chosen_courier,
    'requires_shipping_selection', requires_selection,
    'free_shipping', (shipping = 0 and not requires_selection),
    'tax_sen', tax,
    'total_sen', (subtotal - discount - first_order_sen - loyalty_sen + shipping + tax)
  );
end;
$function$;

revoke all on function public.price_order(uuid, jsonb, text, integer, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.price_order(uuid, jsonb, text, integer, text, text, uuid, text) to service_role;

/* The price-taking form is gone. Left in place, a caller that had not been
   updated would keep naming its own shipping figure — which is the whole thing
   this migration removes. */
drop function if exists public.price_order(uuid, jsonb, text, integer, text, text, integer);
