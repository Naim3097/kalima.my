/*
  Security hardening — addresses three database-linter warnings.

  1. public.is_staff() was reachable as an RPC endpoint (/rest/v1/rpc/is_staff)
     because PostgREST exposes the `public` schema. It cannot simply have
     EXECUTE revoked: RLS policy expressions are evaluated as the querying
     role, so anon/authenticated must retain EXECUTE for the catalog policies
     to work. The fix is to move it to a `private` schema, which PostgREST
     does not expose, and repoint the policies at it.

  2. set_updated_at() had a mutable search_path.
*/

create schema if not exists private;

-- Policies must be dropped before the function they depend on.
drop policy if exists "published collections are public"          on collections;
drop policy if exists "published products are public"             on products;
drop policy if exists "variants follow their product"             on product_variants;
drop policy if exists "images follow their product"               on product_images;
drop policy if exists "collection membership follows its collection" on collection_products;
drop policy if exists "staff manage collections"                  on collections;
drop policy if exists "staff manage collection_products"          on collection_products;
drop policy if exists "staff manage products"                     on products;
drop policy if exists "staff manage product_variants"             on product_variants;
drop policy if exists "staff manage product_images"               on product_images;

drop function if exists public.is_staff();

create function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') in ('staff', 'admin'),
    false
  );
$$;

-- Required so RLS policy expressions can call it as anon/authenticated.
-- `private` is not in PostgREST's exposed schemas, so this adds no API surface.
grant usage on schema private to anon, authenticated;
grant execute on function private.is_staff() to anon, authenticated;

-- Recreate policies against the relocated helper.
create policy "published collections are public"
  on collections for select
  using (published or (select private.is_staff()));

create policy "published products are public"
  on products for select
  using (published or (select private.is_staff()));

create policy "variants follow their product"
  on product_variants for select
  using (
    exists (
      select 1 from products p
      where p.id = product_variants.product_id
        and (p.published or (select private.is_staff()))
    )
  );

create policy "images follow their product"
  on product_images for select
  using (
    exists (
      select 1 from products p
      where p.id = product_images.product_id
        and (p.published or (select private.is_staff()))
    )
  );

create policy "collection membership follows its collection"
  on collection_products for select
  using (
    exists (
      select 1 from collections c
      where c.id = collection_products.collection_id
        and (c.published or (select private.is_staff()))
    )
  );

create policy "staff manage collections"         on collections         for all using ((select private.is_staff())) with check ((select private.is_staff()));
create policy "staff manage collection_products" on collection_products for all using ((select private.is_staff())) with check ((select private.is_staff()));
create policy "staff manage products"            on products            for all using ((select private.is_staff())) with check ((select private.is_staff()));
create policy "staff manage product_variants"    on product_variants    for all using ((select private.is_staff())) with check ((select private.is_staff()));
create policy "staff manage product_images"      on product_images      for all using ((select private.is_staff())) with check ((select private.is_staff()));

/*
  Pin the trigger function's search_path too. now() must be schema-qualified
  because an empty search_path resolves nothing implicitly.
*/
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;
