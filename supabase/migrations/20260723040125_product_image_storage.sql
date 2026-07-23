/*
  Phase 3 — product image storage.

  A public bucket so the storefront can serve photos through the
  /storage/v1/object/public/ endpoint (already whitelisted in next.config
  remotePatterns) with no signing on the read path.

  Writes are staff-only. Uploads from the admin go through a short-lived signed
  upload URL minted server-side by the service role, so the browser never needs
  write credentials; these policies are the defence-in-depth layer for any
  direct authenticated call.

  The product_images table (catalog migration) already models the rows: url,
  alt, color_name (null = product-level shot), position, focal.
*/
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images', 'product-images', true,
  5242880,  -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do nothing;

create policy "public read product images"
  on storage.objects for select
  using (bucket_id = 'product-images');

create policy "staff upload product images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (select private.is_staff()));

create policy "staff update product images"
  on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (select private.is_staff()))
  with check (bucket_id = 'product-images' and (select private.is_staff()));

create policy "staff delete product images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (select private.is_staff()));
