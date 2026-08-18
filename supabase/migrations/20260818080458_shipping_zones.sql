/*
  Shipping stops being one number and becomes a function of the destination.

  Semenanjung RM10, Sabah/Sarawak RM15, and overseas whatever the courier the
  customer picked actually costs. Both Malaysian rates are settings, not
  constants, so changing them is a field in Admin › Shipping rather than a
  deploy — the same reasoning as the flat rate they replace.

  WHY THE ZONE IS A FUNCTION and not a CASE inside price_order: the checkout has
  to classify an address to know whether to ask for a courier at all, and the
  admin will want the same answer when it books. One definition, callable from
  anywhere, is what stops "is Labuan east?" being answered twice.

  LABUAN IS EAST. It is a federal territory, which is why people file it with
  Kuala Lumpur and Putrajaya, but it sits off Borneo and every courier prices it
  as East Malaysia. Getting this wrong does not error — it quietly undercharges
  by RM5 a parcel.
*/
create or replace function public.shipping_zone(p_country text, p_state text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when upper(coalesce(nullif(trim(p_country), ''), 'MY')) <> 'MY' then 'overseas'
    when lower(coalesce(trim(p_state), '')) in (
      'sabah', 'sarawak', 'labuan',
      'wilayah persekutuan labuan', 'w.p. labuan', 'wp labuan'
    ) then 'east'
    else 'west'
  end
$$;

alter table store_settings
  add column shipping_west_sen integer not null default 1000 check (shipping_west_sen >= 0),
  add column shipping_east_sen integer not null default 1500 check (shipping_east_sen >= 0);

/* Seed West from whatever the shop was already charging, so this migration
   changes nothing for a Peninsular order. East is the new RM15. */
update store_settings set shipping_west_sen = flat_shipping_sen where id = 1;

/*
  price_order now takes the destination, and for overseas takes the price of the
  service the customer chose.

  OVERSEAS CANNOT BE PRICED HERE. A courier rate depends on a live quotation, so
  the function reports `requires_shipping_selection` and prices shipping at zero
  until a chosen service is passed in. The caller must not let an order through
  in that state — create_order refuses it — because a zero here is "not known
  yet", never "free".

  The chosen amount arrives as a parameter rather than being re-fetched: the
  shop honours the price the customer was shown, and re-quoting inside the
  pricing function would silently change it.
*/
create or replace function public.price_order(
  p_user_id uuid,
  p_items jsonb,
  p_discount_code text default null,
  p_redeem_points integer default 0,
  p_country text default 'MY',
  p_state text default null,
  p_chosen_shipping_sen integer default null
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

  /*
    New-member discount. Signed in, the shop is running one, no code in play —
    and not already held by another order of theirs, which is what stops a
    member taking it twice by abandoning a checkout.
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
    Shipping.

    A free-shipping code is an explicit grant to one customer and wins in every
    zone. Otherwise Malaysia pays its zone rate and overseas pays the service
    the customer chose — with the threshold, if the shop ever sets one, applying
    to Malaysian orders only. An overseas parcel can cost more than the goods,
    and a spend-based offer was never meant to cover it.
  */
  if free_ship then
    shipping := 0;
  elsif zone = 'overseas' then
    if p_chosen_shipping_sen is null then
      requires_selection := true;
      shipping := 0;  -- not known yet, never free
    else
      shipping := greatest(p_chosen_shipping_sen, 0);
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
    'requires_shipping_selection', requires_selection,
    'free_shipping', (shipping = 0 and not requires_selection),
    'tax_sen', tax,
    'total_sen', (subtotal - discount - first_order_sen - loyalty_sen + shipping + tax)
  );
end;
$function$;

revoke all on function public.price_order(uuid, jsonb, text, integer, text, text, integer) from public, anon, authenticated;
grant execute on function public.price_order(uuid, jsonb, text, integer, text, text, integer) to service_role;

/* The four-argument form is gone — every caller passes a destination now, and
   leaving it in place would let one quietly price at the West rate. */
drop function if exists public.price_order(uuid, jsonb, text, integer);
