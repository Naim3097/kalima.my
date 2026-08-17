/*
  Finish the uuid_generate_v4() -> gen_random_uuid() move on the catalogue tables.

  20260722060902 did this for the commerce tables (orders, addresses, payments,
  order_items, stock_movements, discount_codes, discount_redemptions) because
  uuid_generate_v4() lives in the `extensions` schema and is therefore invisible
  to a SECURITY DEFINER function running with search_path = ''. It never covered
  the four catalogue tables.

  20260720094446 was later edited to CREATE these columns with gen_random_uuid()
  so `supabase db push` could build a fresh database at all. That fixes new
  projects only — it cannot retroactively change a table production created in
  July. So the two diverged, and comparing the projects on 2026-08-17 found
  exactly this: identical everywhere (41 tables, 419 columns, 63 policies) except
  four `id` defaults.

  Nothing is broken today: catalogue rows are written through PostgREST as
  `authenticated`, where `extensions` is on the search_path. The risk is latent —
  the first SECURITY DEFINER function that inserts a catalogue row without
  supplying an id would fail on production and pass everywhere else, which is the
  worst shape a bug can have. This removes that difference.

  A no-op on any database built from the current migrations.
*/
alter table products         alter column id set default gen_random_uuid();
alter table product_variants alter column id set default gen_random_uuid();
alter table product_images   alter column id set default gen_random_uuid();
alter table collections      alter column id set default gen_random_uuid();
