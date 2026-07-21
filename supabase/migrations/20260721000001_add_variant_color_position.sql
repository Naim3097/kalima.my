/*
  Colour ordering was not persisted: product_variants.position is the size
  index within a colour, so colour order itself was implicit and would come
  back from the database in arbitrary order.

  It is user-visible — swatches render in this order, the first colour is the
  default selection, and the product-level photo represents colour #1 — so it
  has to be stored.

  Denormalised onto the variant (repeated across that colour's sizes) rather
  than split into a product_colors table. If colours later grow attributes of
  their own (per-colour stock rollups, names per locale), promoting them to
  their own table is the natural next step.
*/
alter table product_variants
  add column color_position integer not null default 0;

comment on column product_variants.position is
  'Size index within a colour (0-based).';
comment on column product_variants.color_position is
  'Colour index within the product (0-based). Drives swatch order and the default selection.';

create index product_variants_order_idx
  on product_variants (product_id, color_position, position);
