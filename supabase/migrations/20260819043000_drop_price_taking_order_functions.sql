/*
  Removes the overloads that accepted a shipping price as an argument.

  price_order(…, p_chosen_shipping_sen) and its create_order counterpart were
  replaced by the quote-taking pair on 2026-08-18. Staging dropped them in the
  same migration; production could not, because the deploy still serving there
  was calling them — so both signatures coexisted for the length of one build.

  They are dropped now for the reason they were replaced: left in place, a
  caller that had not been updated would keep naming its own shipping figure,
  and PostgREST resolves by argument name, so it would resolve silently and
  charge whatever it was handed. `if exists` because staging is already without
  them; this migration is a no-op there.
*/
drop function if exists public.price_order(uuid, jsonb, text, integer, text, text, integer);
drop function if exists public.create_order(uuid, jsonb, text, text, jsonb, text, text, integer, integer);
