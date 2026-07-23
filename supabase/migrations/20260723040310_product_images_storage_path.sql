/*
  Track the storage object key alongside the public URL so removing an image
  row can also delete the underlying file from the bucket. Null for the seeded
  rows that point at /public paths rather than Storage.
*/
alter table product_images add column storage_path text;
