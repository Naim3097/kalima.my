/*
  Archive for products that cannot be deleted.

  order_items.product_variant_id is ON DELETE RESTRICT — a sold product has to
  keep its variants so refunds can return stock and order history can point at
  what was bought. Staff still need to get a discontinued piece out of the way,
  so archiving hides it from the admin list while keeping every row.

  The check constraint makes "archived" imply "unpublished" in the database
  rather than in each code path: the storefront, lookbook and Instagram pickers
  already filter on published, so an archived product drops out of all of them
  without any of them knowing archives exist.

  Applied to staging and production on 2026-11-03.
*/
alter table public.products add column archived_at timestamptz;

comment on column public.products.archived_at is
  'Set when staff archive a product that cannot be deleted (it has orders). Archived products are hidden from the admin list and can never be published.';

alter table public.products
  add constraint products_archived_not_published
  check (archived_at is null or not published);
