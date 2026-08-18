/*
  The storefront's delivery note quotes the rate, so it needs both zone rates —
  not the flat one they replaced.

  It was still reading flat_shipping_sen and printing "Standard delivery RM10"
  under an address the summary had already priced at RM15. Two figures on one
  screen disagreeing about the same parcel is exactly the class of fault the
  single pricing function exists to prevent; this closes the last place the old
  number could still be read.

  flat_shipping_sen stays in the payload for now: nothing prices from it, but
  removing a field an older deployment may still read is a separate step from
  adding the ones that replace it.
*/
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
    'free_shipping_threshold_sen', s.free_shipping_threshold_sen
  )
  from public.store_settings s
  where s.id = 1;
$$;

revoke all on function public.shop_public_settings() from public;
grant execute on function public.shop_public_settings() to anon, authenticated, service_role;
