/*
  A "Sale" smart collection, so the homepage's On Sale row has somewhere to send
  people.

  WHY THIS ROW EXISTS AT ALL. The homepage row used to be the bestSeller flag
  under an "On Sale" heading, with "View All" pointing at /collections/best-
  sellers. That was honest while nothing carried a discount price; once sale
  prices shipped it started showing full-price pieces to shoppers who had just
  read the word SALE. The row now filters on the discount itself, and needed a
  matching destination.

  SMART, like best-sellers and new-arrivals: membership is derived in
  fetchCollection from `sale_price_sen` being set, so a piece joins when it is
  discounted and leaves when the discount is cleared. Nothing to maintain, and no
  way for the collection to disagree with the prices on the cards.

  sort_order 5 puts it after the existing five. It is deliberately NOT added to
  the header: that nav is the hardcoded NAV list in src/data/catalog.ts, so this
  row changes no navigation on its own — whether Sale deserves a nav slot is a
  merchandising decision, not a consequence of adding the collection.
*/
insert into collections (slug, title, description, is_smart, sort_order, published)
values (
  'sale',
  'Sale',
  'Reduced for a limited time.',
  true,
  5,
  true
)
on conflict (slug) do nothing;
