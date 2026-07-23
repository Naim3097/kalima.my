/*
  Phase 3 — store settings + staff role management.

  store_settings is a single row (id=1) holding shipping/tax config and store
  info. create_order reads shipping + free-shipping threshold + tax from it, so
  the shop owner controls the money rules without a deploy — still computed
  server-side, never trusted from the client.
*/
create table store_settings (
  id                          int primary key default 1 check (id = 1),
  store_name                  text not null default 'Kalima',
  store_email                 text not null default 'hello@kalima.my',
  store_phone                 text,
  currency                    text not null default 'MYR',
  free_shipping_threshold_sen integer not null default 30000 check (free_shipping_threshold_sen >= 0),
  flat_shipping_sen           integer not null default 1000  check (flat_shipping_sen >= 0),
  tax_rate_bps                integer not null default 0 check (tax_rate_bps between 0 and 10000), -- basis points
  updated_at                  timestamptz not null default now()
);
insert into store_settings (id) values (1);

alter table store_settings enable row level security;
create trigger store_settings_updated_at before update on store_settings
  for each row execute function set_updated_at();

-- Store config is public-readable (shipping threshold + contact show on the
-- storefront); only staff write.
create policy "store settings are public" on store_settings for select using (true);
create policy "staff manage store settings" on store_settings for all
  using ((select private.is_staff())) with check ((select private.is_staff()));
grant select on store_settings to anon, authenticated;

-- Orders gain a tax line (0 unless a tax rate is set).
alter table orders add column tax_sen integer not null default 0 check (tax_sen >= 0);

/*
  The self-elevation guard blocked EVERY non-staff writer, including the
  service-role backend the admin uses to change roles. Allow the service role
  (trusted server code, key never in the browser) through — a customer's JWT is
  'authenticated', not 'service_role', so they stay blocked.
*/
create or replace function private.protect_profile_role()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role is distinct from old.role
     and not (select private.is_staff())
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    new.role = old.role;
  end if;
  return new;
end;
$$;

-- create_order now reads shipping/tax from store_settings.
create or replace function public.create_order(
  p_user_id uuid, p_items jsonb, p_email text, p_phone text,
  p_address jsonb, p_shipping_method text, p_discount_code text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item jsonb; v public.product_variants; p public.products;
  unit_price integer; line_qty integer;
  subtotal integer := 0; discount integer := 0; shipping integer := 0; tax integer := 0;
  free_ship boolean := false;
  cfg public.store_settings;
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

  if (subtotal - discount) >= cfg.free_shipping_threshold_sen or free_ship then
    shipping := 0;
  else
    shipping := cfg.flat_shipping_sen;
  end if;

  tax := round((subtotal - discount) * cfg.tax_rate_bps / 10000.0);

  insert into public.orders (
    id, user_id, email, phone, status, subtotal_sen, discount_sen, shipping_sen, tax_sen, total_sen,
    discount_code, shipping_method, shipping_address
  ) values (
    new_order_id, p_user_id, trim(p_email), p_phone, 'pending',
    subtotal, discount, shipping, tax, (subtotal - discount + shipping + tax),
    case when discount > 0 or free_ship then p_discount_code end, p_shipping_method, p_address
  ) returning reference into new_reference;

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

  return jsonb_build_object('order_id', new_order_id, 'reference', new_reference,
    'total_sen', (subtotal - discount + shipping + tax));
end;
$$;
