/*
  Phase 2 — commerce entry-point functions. All SECURITY DEFINER with a pinned
  search_path; each function body is the trust boundary.

  All four are service_role-only, called from server-side app code (checkout
  server action, confirmation page, payment webhook) — never exposed as
  anon/authenticated RPCs. Locking down needs revoke from *all three*
  (public, anon, authenticated): Supabase's default privileges grant new
  public functions explicit anon/authenticated EXECUTE on top of the built-in
  PUBLIC grant, so revoking only one leaves the function reachable.

  FREE_SHIPPING_THRESHOLD = RM300 (30000 sen); flat shipping RM10 (1000 sen)
  below it — placeholder until EasyParcel live rates (Phase 4).
*/

create function public.validate_discount(p_code text, p_subtotal_sen integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.discount_codes; discount integer := 0;
begin
  select * into c from public.discount_codes
  where upper(code) = upper(trim(p_code)) and active limit 1;
  if not found then
    return jsonb_build_object('valid', false, 'reason', 'Code not found', 'discount_sen', 0);
  end if;
  if c.starts_at is not null and now() < c.starts_at then
    return jsonb_build_object('valid', false, 'reason', 'Code not yet active', 'discount_sen', 0);
  end if;
  if c.ends_at is not null and now() > c.ends_at then
    return jsonb_build_object('valid', false, 'reason', 'Code expired', 'discount_sen', 0);
  end if;
  if c.max_redemptions is not null and c.redeemed_count >= c.max_redemptions then
    return jsonb_build_object('valid', false, 'reason', 'Code fully redeemed', 'discount_sen', 0);
  end if;
  if p_subtotal_sen < c.min_spend_sen then
    return jsonb_build_object('valid', false,
      'reason', 'Spend at least RM' || (c.min_spend_sen / 100) || ' to use this code', 'discount_sen', 0);
  end if;

  if c.kind = 'percent' then discount := (p_subtotal_sen * c.amount) / 100;
  elsif c.kind = 'fixed' then discount := least(c.amount, p_subtotal_sen);
  else discount := 0; end if;

  return jsonb_build_object('valid', true, 'code', c.code, 'kind', c.kind,
    'discount_sen', discount, 'free_shipping', (c.kind = 'free_shipping'));
end;
$$;

/*
  Creates a PENDING order. Prices/discount/shipping are all computed here from
  the database — nothing about money is trusted from the caller. Items arrive
  as [{variant_id, qty}, ...]. p_user_id is the verified caller (null = guest),
  passed by the server action since auth.uid() is null under service_role.
  Does NOT touch stock — reservation happens at payment. Returns
  { order_id, reference, total_sen }.
*/
create function public.create_order(
  p_user_id uuid, p_items jsonb, p_email text, p_phone text,
  p_address jsonb, p_shipping_method text, p_discount_code text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item jsonb; v public.product_variants; p public.products;
  unit_price integer; line_qty integer;
  subtotal integer := 0; discount integer := 0; shipping integer := 0;
  free_ship boolean := false;
  new_order_id uuid; new_reference text; disc jsonb; disc_id uuid;
begin
  if p_email is null or trim(p_email) = '' then raise exception 'email is required'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'cart is empty'; end if;

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

  if (subtotal - discount) >= 30000 or free_ship then shipping := 0; else shipping := 1000; end if;

  insert into public.orders (
    id, user_id, email, phone, status, subtotal_sen, discount_sen, shipping_sen, total_sen,
    discount_code, shipping_method, shipping_address
  ) values (
    new_order_id, p_user_id, trim(p_email), p_phone, 'pending',
    subtotal, discount, shipping, (subtotal - discount + shipping),
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
    'total_sen', (subtotal - discount + shipping));
end;
$$;

/*
  Confirms payment: idempotent + oversell-guarded, one transaction. Called ONLY
  by the payment webhook (service_role). No-op if already paid (webhooks
  retry); decrements each variant with a guard + ledger row; flips the order to
  'paid'. Any unfulfillable line rolls the whole thing back — the order stays
  pending for reconciliation.
*/
create function public.mark_order_paid(
  p_order_id uuid, p_provider text, p_provider_ref text,
  p_amount_sen integer, p_raw jsonb default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.orders; it public.order_items; updated integer;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;

  if o.status = 'paid' or o.paid_at is not null then
    return jsonb_build_object('status', 'already_paid', 'reference', o.reference);
  end if;
  if o.status <> 'pending' then
    raise exception 'order % is % — cannot pay', o.reference, o.status;
  end if;

  insert into public.payments (order_id, provider, provider_ref, status, amount_sen, raw)
  values (p_order_id, p_provider, p_provider_ref, 'paid', p_amount_sen, p_raw)
  on conflict (provider, provider_ref) where provider_ref is not null
  do update set status = 'paid', raw = excluded.raw, updated_at = now();

  for it in select * from public.order_items where order_id = p_order_id loop
    update public.product_variants set stock_on_hand = stock_on_hand - it.qty
      where id = it.product_variant_id and stock_on_hand >= it.qty;
    get diagnostics updated = row_count;
    if updated = 0 then raise exception 'insufficient stock for %', it.variant_sku; end if;
    insert into public.stock_movements (product_variant_id, type, qty_delta, order_id, reason)
    values (it.product_variant_id, 'sale', -it.qty, p_order_id, 'order ' || o.reference);
  end loop;

  update public.orders set status = 'paid', paid_at = now() where id = p_order_id;

  update public.discount_codes dc set redeemed_count = redeemed_count + 1
  from public.discount_redemptions r
  where r.order_id = p_order_id and r.discount_code_id = dc.id;

  return jsonb_build_object('status', 'paid', 'reference', o.reference);
end;
$$;

/*
  Guest-safe order lookup for the confirmation page: returns the order + items
  only when the email matches (guests have no session, so RLS can't key on
  auth.uid()). Signed-in users still use RLS-backed reads.
*/
create function public.get_order_by_reference(p_reference text, p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders
  where reference = p_reference and lower(email) = lower(trim(p_email));
  if not found then return null; end if;

  return jsonb_build_object(
    'reference', o.reference, 'status', o.status, 'email', o.email,
    'subtotal_sen', o.subtotal_sen, 'discount_sen', o.discount_sen,
    'shipping_sen', o.shipping_sen, 'total_sen', o.total_sen,
    'shipping_address', o.shipping_address, 'created_at', o.created_at,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'product_name', i.product_name, 'color_name', i.color_name,
        'size', i.size, 'qty', i.qty, 'line_total_sen', i.line_total_sen
      ) order by i.product_name), '[]'::jsonb)
      from public.order_items i where i.order_id = o.id
    )
  );
end;
$$;

-- All four functions are server-side only. Revoke from public AND
-- anon/authenticated (see header note), then grant service_role.
revoke all on function public.validate_discount(text, integer)                          from public, anon, authenticated;
revoke all on function public.create_order(uuid, jsonb, text, text, jsonb, text, text)   from public, anon, authenticated;
revoke all on function public.mark_order_paid(uuid, text, text, integer, jsonb)          from public, anon, authenticated;
revoke all on function public.get_order_by_reference(text, text)                         from public, anon, authenticated;

grant execute on function public.validate_discount(text, integer)                        to service_role;
grant execute on function public.create_order(uuid, jsonb, text, text, jsonb, text, text) to service_role;
grant execute on function public.mark_order_paid(uuid, text, text, integer, jsonb)        to service_role;
grant execute on function public.get_order_by_reference(text, text)                       to service_role;
