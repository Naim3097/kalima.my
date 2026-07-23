create or replace function public.adjust_stock(p_variant_id uuid, p_delta integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_stock integer;
begin
  if p_delta = 0 then
    raise exception 'adjustment must be non-zero';
  end if;

  update public.product_variants
  set stock_on_hand = stock_on_hand + p_delta
  where id = p_variant_id and stock_on_hand + p_delta >= 0
  returning stock_on_hand into new_stock;

  if not found then
    raise exception 'adjustment would take stock below zero';
  end if;

  insert into public.stock_movements (product_variant_id, type, qty_delta, reason)
  values (
    p_variant_id,
    (case when p_delta > 0 then 'restock' else 'adjustment' end)::public.stock_movement_type,
    p_delta,
    coalesce(nullif(trim(p_reason), ''), 'manual adjustment')
  );

  return new_stock;
end;
$$;
