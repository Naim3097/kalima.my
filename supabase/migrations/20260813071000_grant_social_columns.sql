/*
  Let the storefront read the social links.

  store_settings has no blanket select grant — 20260723103945 narrowed it to a
  COLUMN list the moment the EasyParcel access token moved in, because a
  table-level grant would publish that token to every visitor. New columns are
  therefore invisible to anon by default, which is the safe direction to fail
  in, and exactly what happened here: the footer read came back empty rather
  than leaking anything.

  So the four profile URLs are added to that same column list. Nothing else on
  the table becomes readable, and the token stays where it is.

  A postgres column grant is not additive with the earlier statement — it is a
  separate grant on separate columns — so this does not need to restate the
  original list, and cannot accidentally narrow it.
*/
grant select (
  social_instagram, social_tiktok, social_facebook, social_threads
) on public.store_settings to anon, authenticated;
