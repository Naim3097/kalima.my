/*
  Malaysian shoppers choose their courier too.

  Until now Malaysia paid a zone rate (Semenanjung / Sabah & Sarawak) and only
  overseas addresses were shown live EasyParcel rates. The shop now wants the
  EasyStore-style checkout for local orders as well: the customer picks a
  courier, pays what that courier costs, and the admin books exactly that
  service.

  IT IS A MODE, NOT A REPLACEMENT. `domestic_shipping_mode` keeps the zone
  rate one click away in Admin › Shipping, because the courier path depends on
  a live API that has already gone dark once (20 Aug 2026, every endpoint 404)
  and a shop that cannot quote cannot sell. In 'courier' mode Malaysia goes
  through the same frozen-quote path overseas already uses — the browser still
  never names a price. In 'zone' mode nothing changes.
*/
alter table store_settings
  add column domestic_shipping_mode text not null default 'zone'
    check (domestic_shipping_mode in ('zone', 'courier'));

/*
  price_order: the courier branch now serves any destination whose mode says so.

  The body is otherwise the 2026-08-18 definition verbatim; only the shipping
  block changes. A free-shipping code still wins everywhere, and the free
  threshold (when it is on) still applies to Malaysia in either mode — it is a
  promise about the customer's spend, not about who carries the parcel.
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
  by_courier boolean := false;
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
    Shipping. A free-shipping code is an explicit grant and wins in every zone,
    as does the spend threshold when it is switched on. Otherwise: overseas
    always pays the frozen price of the courier the customer chose; Malaysia
    does the same when the shop is in 'courier' mode, and pays its zone rate
    in 'zone' mode. When a courier price is wanted and cannot be found, nothing
    is priced — a zero here is "not known yet", never "free".
  */
  by_courier := (zone = 'overseas') or (cfg.domestic_shipping_mode = 'courier');

  if free_ship then
    shipping := 0;
  elsif zone <> 'overseas'
        and cfg.free_shipping_threshold_sen > 0
        and (subtotal - discount) >= cfg.free_shipping_threshold_sen then
    shipping := 0;
  elsif by_courier then
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
    'shipping_by_courier', by_courier,
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

/* The checkout page reads the mode to know whether to show the courier list
   for a Malaysian address. Not a secret; the zone rates already travel this
   way. */
create or replace function public.shop_public_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'company_name',                s.company_name,
    'company_reg_no',              s.company_reg_no,
    'footer_tagline',              s.footer_tagline,
    'footer_payment_note',         s.footer_payment_note,
    'flat_shipping_sen',           s.flat_shipping_sen,
    'shipping_west_sen',           s.shipping_west_sen,
    'shipping_east_sen',           s.shipping_east_sen,
    'free_shipping_threshold_sen', s.free_shipping_threshold_sen,
    'domestic_shipping_mode',      s.domestic_shipping_mode
  )
  from public.store_settings s
  where s.id = 1;
$$;

revoke all on function public.shop_public_settings() from public;
grant execute on function public.shop_public_settings() to anon, authenticated, service_role;
