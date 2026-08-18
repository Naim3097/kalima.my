/*
  The handful of store_settings fields the STOREFRONT is allowed to read.

  store_settings has no RLS policy and grants anon nothing, which is right: the
  row holds the EasyParcel access and refresh tokens. But the footer's company
  details and the checkout's delivery rate live in the same row, and both are
  read by the public (session-less) client — so both silently fell back to their
  hardcoded defaults on every page load. Nobody noticed because the defaults are
  character-identical to the live values: the footer looked correct while
  ignoring the CMS entirely, and editing the company name in the back office
  changed nothing on the site.

  A SECURITY DEFINER function rather than a grant on the table, because the
  question is not "may the public read this row" — it may not — but "which
  FIELDS of it are already public anyway". Everything returned here is printed
  on the page it is read for. Nothing else can be reached through it, and no
  future column is exposed by accident: adding one to the table does not add it
  here.

  Not a view, deliberately: a view over an RLS-protected table has to run as its
  owner to be useful, which is exactly what Supabase's linter flags. This
  project keeps that linter at zero warnings.
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
    'free_shipping_threshold_sen', s.free_shipping_threshold_sen
  )
  from public.store_settings s
  where s.id = 1;
$$;

revoke all on function public.shop_public_settings() from public;
grant execute on function public.shop_public_settings() to anon, authenticated, service_role;
