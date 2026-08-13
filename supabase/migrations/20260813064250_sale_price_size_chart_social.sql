/*
  Three small catalog/storefront additions.

  1. SALE PRICE. `products.sale_price_sen` is the "now" price; `price_sen`
     stays the list price the storefront strikes through. Null means the
     product is not on sale — the shape every existing row already has, so
     nothing changes until someone sets one.

     The resolution rule is one coalesce, and create_order is the authority:

       coalesce(v.price_sen, p.sale_price_sen, p.price_sen)

     A variant price override still wins, because an override is a deliberate
     per-SKU price and a blanket product sale must not silently undercut it.
     The database constraint keeps a "sale" honest — it must be BELOW the list
     price, or the strike-through would lie to the customer.

  2. SIZE CHART. A product-level image with no colour scope. It deliberately
     does NOT live in product_images: every row there is merchandising
     photography that the storefront orders, picks a hero from and swaps on a
     swatch click. A size chart is a document, and one product has exactly one.
     A nullable column says that; a product_images row with a magic flag would
     not, and would put a chart one drag away from becoming the PLP hero.

  3. SOCIAL LINKS. Storefront profile URLs on store_settings, which is already
     public-readable and staff-writable, so the shop owner edits them in the
     back office rather than in a deploy.
*/

alter table public.products
  add column sale_price_sen integer,
  add column size_chart_url  text,
  add column size_chart_path text;

alter table public.products
  add constraint products_sale_price_below_list
  check (sale_price_sen is null or (sale_price_sen >= 0 and sale_price_sen < price_sen));

comment on column public.products.sale_price_sen is
  'Discounted price in sen. Null = not on sale. Must be below price_sen, which the storefront shows struck through.';
comment on column public.products.size_chart_path is
  'Storage object key for size_chart_url, kept so the file can be removed when the chart is replaced or cleared.';

alter table public.store_settings
  add column social_instagram text,
  add column social_tiktok    text,
  add column social_facebook  text,
  add column social_threads   text;

/*
  create_order, unchanged from 20260812071500 except for the two unit_price
  lines. Repeated in full because Postgres has no way to patch a function body,
  and the file must remain a faithful record of what ran.
*/
create or replace function public.create_order(
  p_user_id uuid,
  p_items jsonb,
  p_email text,
  p_phone text,
  p_address jsonb,
  p_shipping_method text,
  p_discount_code text default null::text,
  p_redeem_points integer default 0
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
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
    'total_sen', (subtotal - discount - loyalty_sen + shipping + tax),
    'loyalty_points_used', redeem_pts, 'loyalty_discount_sen', loyalty_sen
  );
end;
$$;
