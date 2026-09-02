/*
  Women, Men and Accessories become smart collections, derived from
  products.category.

  WHY. They were curated lists — membership rows in collection_products — but
  the admin has no collection editor, so the only way a product ever joined one
  was the seed SQL. Every product created through the admin since then had a
  category and no membership, and was therefore missing from the page its
  homepage tile links to. Three published products sat in that state on
  production (maya-caftan, tiaraa-top, warna-warisan) while showing normally in
  New Arrivals and search, which is why nobody noticed.

  fetchCollection (src/data/catalog.queries.ts) now filters these three slugs on
  category, the same way new-arrivals filters on its flag. The Category dropdown
  on the product form is the assignment; there is nothing for staff to maintain.

  The old membership rows are left in place. Smart collections never read them,
  and keeping them costs nothing while making a rollback a one-line flip.

  Applied to staging by hand on 2026-09-02 before this file was committed.
*/
update collections
set is_smart = true
where slug in ('women', 'men', 'accessories')
  and is_smart = false;

/*
  The hero's primary button said "New Collection" and pointed at
  /collections/new-arrivals, under an eyebrow that said "New Arrivals". One
  destination, one name.
*/
update hero_slides
set primary_label = 'New Arrivals'
where primary_label = 'New Collection';
