/*
  Remove the curated membership rows for women, men and accessories.

  20260902083000 made those three collections smart (derived from
  products.category) and deliberately left the old collection_products rows in
  place as a rollback path. They were removed the same day: smart collections
  never read them, and a stale list that looks like the source of truth is how
  the next person "fixes" a missing product by inserting a row that does nothing.

  Applied to staging and production by hand on 2026-09-02.
*/
delete from collection_products cp
using collections c
where c.id = cp.collection_id
  and c.slug in ('women', 'men', 'accessories');
