/*
  Closes a Phase 7 information leak, and the default that caused it.

  THE LEAK. loyalty_balance(uuid) and customer_tier(uuid) are SECURITY DEFINER,
  so they bypass RLS by design — and both were reachable at /rest/v1/rpc/<name>
  by `anon`. Anyone holding the publishable anon key, which ships in the browser
  bundle, could read any customer's point balance and membership tier given
  their user id:

      POST /rest/v1/rpc/customer_tier  {"p_user_id": "<any uuid>"}

  Confirmed live before this migration: both returned real data with no session
  at all.

  WHY IT HAPPENED, AND WHY A GRANT WAS NOT ENOUGH. The Phase 7 migration ended
  with

      grant execute on function public.loyalty_balance(uuid) to authenticated, service_role;

  and a comment reading "Balance and tier are safe to read for one's own
  account". The intent was right; the mechanism was not. Supabase's default
  privileges already grant `anon` and `authenticated` EXECUTE on every new
  function in `public`, so adding a grant changes nothing that was not already
  permitted — locking a function down requires an explicit REVOKE, exactly as
  the sibling functions in that same file did:

      revoke all on function public.award_loyalty_points(uuid) from public, anon, authenticated;

  This is the second time this default has bitten: 20260722061113 fixed the same
  class of bug on mark_order_paid, where a PUBLIC grant let anyone mark an order
  paid without paying.

  Note also that the intent — "one's own account" — was never enforced. Nothing
  in either function compared p_user_id to auth.uid(), so even the authenticated
  grant allowed any signed-in customer to read any other customer's standing.
  Rather than add a caller check, the grant goes away entirely: every caller in
  the application is server-side through the service-role client
  (src/lib/loyalty.ts, src/lib/commerce.ts), so nothing needs the RPC to be
  reachable from a browser. Removing the exposure beats guarding it.
*/

revoke all on function public.loyalty_balance(uuid) from public, anon, authenticated;
revoke all on function public.customer_tier(uuid)   from public, anon, authenticated;
grant execute on function public.loyalty_balance(uuid) to service_role;
grant execute on function public.customer_tier(uuid)   to service_role;

/*
  set_updated_at is a trigger function. Calling it over RPC raises "trigger
  functions can only be called as triggers", so it leaks nothing today — but a
  trigger helper has no business being in the exposed API surface at all.
*/
revoke all on function public.set_updated_at() from public, anon, authenticated;

/*
  Drops an orphaned create_order overload.

  20260723152503 added p_redeem_points, and `create or replace function` with a
  new parameter list creates a SECOND function rather than replacing the first.
  The seven-argument version therefore survived, and it predates loyalty
  entirely — verified: its body contains no reference to loyalty or redemption.
  A caller reaching it would create an order that silently ignores the points
  the customer asked to spend.

  PostgREST resolves overloads by argument name, and the application always
  sends p_redeem_points, so the live path has been correct. That is luck, not
  design. The Phase 3 refund work established the rule this follows: the buggy
  path should be unreachable rather than merely unused.
*/
drop function if exists public.create_order(uuid, jsonb, text, text, jsonb, text, text);

/*
  An attempt to stop this recurring — WHICH DID NOT WORK. Superseded by
  20260803065200, which reverts it and records the measurement.

  The intent was that new functions in `public` should not be anon-reachable by
  default. Postgres, however, grants EXECUTE to PUBLIC on every new function as
  a built-in default, applied IN ADDITION TO the pg_default_acl entry rather
  than replaced by it — so anon still reaches a new function through PUBLIC and
  this line changes reachability not at all.

  Left in place rather than edited out because it is what actually ran. The real
  rule is unchanged and is enforced per function, above: revoke from all three
  of public, anon and authenticated.
*/
alter default privileges in schema public revoke execute on functions from anon, authenticated;
