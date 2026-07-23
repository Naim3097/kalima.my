/*
  uuid_generate_v4() (uuid-ossp, in the `extensions` schema) is unreachable from
  a SECURITY DEFINER function with search_path='' — both the explicit call and
  the table-default evaluation fail there. gen_random_uuid() is in pg_catalog,
  always in scope. Repoint the Phase 2 table defaults and recreate create_order.
*/
alter table addresses            alter column id set default gen_random_uuid();
alter table orders               alter column id set default gen_random_uuid();
alter table order_items          alter column id set default gen_random_uuid();
alter table payments             alter column id set default gen_random_uuid();
alter table stock_movements      alter column id set default gen_random_uuid();
alter table discount_codes       alter column id set default gen_random_uuid();
alter table discount_redemptions alter column id set default gen_random_uuid();

create or replace function public.create_order(
  p_items    jsonb,
  p_email    text,
  p_phone    text,
  p_address  jsonb,
  p_shipping_method text,
  p_discount_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item          jsonb;
  v             public.product_variants;
  p             public.products;
  unit_price    integer;
  line_qty      integer;
  subtotal      integer := 0;
  discount      integer := 0;
  shipping      integer := 0;
  free_ship     boolean := false;
  new_order_id  uuid;
  new_reference text;
  disc          jsonb;
  disc_id       uuid;
begin
  if p_email is null or trim(p_email) = '' then
    raise exception 'email is required';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'cart is empty';
  end if;

  new_order_id := gen_random_uuid();

  for item in select * from jsonb_array_elements(p_items) loop
    line_qty := (item ->> 'qty')::integer;
    if line_qty is null or line_qty <= 0 then
      raise exception 'invalid quantity';
    end if;

    select * into v from public.product_variants where id = (item ->> 'variant_id')::uuid;
    if not found then
      raise exception 'variant % not found', item ->> 'variant_id';
    end if;

    select * into p from public.products where id = v.product_id;
    if not p.published then
      raise exception 'product % is not available', p.name;
    end if;

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

  if (subtotal - discount) >= 30000 or free_ship then
    shipping := 0;
  else
    shipping := 1000;
  end if;

  insert into public.orders (
    id, user_id, email, phone, status,
    subtotal_sen, discount_sen, shipping_sen, total_sen,
    discount_code, shipping_method, shipping_address
  ) values (
    new_order_id, auth.uid(), trim(p_email), p_phone, 'pending',
    subtotal, discount, shipping, (subtotal - discount + shipping),
    case when discount > 0 or free_ship then p_discount_code end,
    p_shipping_method, p_address
  )
  returning reference into new_reference;

  for item in select * from jsonb_array_elements(p_items) loop
    line_qty := (item ->> 'qty')::integer;
    select * into v from public.product_variants where id = (item ->> 'variant_id')::uuid;
    select * into p from public.products where id = v.product_id;
    unit_price := coalesce(v.price_sen, p.price_sen);

    insert into public.order_items (
      order_id, product_variant_id, product_name, variant_sku,
      color_name, size, unit_price_sen, qty, line_total_sen
    ) values (
      new_order_id, v.id, p.name, v.sku,
      v.color_name, v.size, unit_price, line_qty, unit_price * line_qty
    );
  end loop;

  if (disc ->> 'valid')::boolean is true then
    select id into disc_id from public.discount_codes
    where upper(code) = upper(trim(p_discount_code));
    insert into public.discount_redemptions (discount_code_id, order_id, user_id)
    values (disc_id, new_order_id, auth.uid());
  end if;

  return jsonb_build_object(
    'order_id', new_order_id, 'reference', new_reference,
    'total_sen', (subtotal - discount + shipping)
  );
end;
$$;

grant execute on function public.create_order(jsonb, text, text, jsonb, text, text) to anon, authenticated;
