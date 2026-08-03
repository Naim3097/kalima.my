/*
  Reverts the default-privilege change made in 20260803064500, which did not do
  what it claimed.

  That migration ended with

      alter default privileges in schema public revoke execute on functions from anon, authenticated;

  intending to stop new functions in `public` being reachable by anon — the
  default that produced the loyalty_balance/customer_tier leak, and the
  mark_order_paid leak before it.

  IT DOES NOT WORK, measured rather than assumed. Postgres grants EXECUTE to
  PUBLIC on every new function as a BUILT-IN default, and that grant is applied
  IN ADDITION TO the pg_default_acl entry rather than being replaced by it.
  After the change, pg_default_acl for (postgres, public, functions) read
  {postgres=X, service_role=X} with anon absent — and a freshly created probe
  function still came out as {=X/postgres, postgres=X/postgres,
  service_role=X/postgres}. The leading `=X` is PUBLIC, and anon holds EXECUTE
  through it. Adding `revoke execute on functions from public` to the default
  privileges did not remove it either.

  Net effect of the change was therefore cosmetic: fewer explicit grantees in
  the ACL, identical reachability. Keeping a half-measure that reads like a
  protection is worse than not having it, because the next person to add a
  function would trust it.

  So the default returns to the Supabase standard, and the actual rule stands
  where it always was — stated in supabase/README.md and applied by every
  function in this project except the two that slipped:

      every new SECURITY DEFINER function in `public` MUST carry an explicit
      revoke all on function ... from public, anon, authenticated;

  all three, because `public` covers the built-in grant and the other two cover
  Supabase's default privileges.
*/

alter default privileges in schema public grant execute on functions to anon, authenticated;
