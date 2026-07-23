/*
  SECURITY FIX. Postgres grants EXECUTE on new functions to PUBLIC by default,
  so `revoke ... from anon, authenticated` left the PUBLIC grant intact — any
  caller could mark an order paid without paying. Revoke from PUBLIC (the real
  source of the grant) and re-grant only to service_role (the webhook).
*/
revoke all on function public.mark_order_paid(uuid, text, text, integer, jsonb) from public;
revoke all on function public.mark_order_paid(uuid, text, text, integer, jsonb) from anon, authenticated;
grant execute on function public.mark_order_paid(uuid, text, text, integer, jsonb) to service_role;
