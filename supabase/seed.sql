-- GENERATED FILE — do not edit by hand.
-- Source: src/data/catalog.ts · Regenerate: npm run seed:generate

begin;

-- Idempotent: truncate cascades through variants, images and membership.
truncate table products, collections restart identity cascade;

-- Collections
insert into collections (slug, title, description, is_smart, sort_order) values ('women', 'Women', 'Abaya, kurung, dresses and modest essentials.', false, 0);
insert into collections (slug, title, description, is_smart, sort_order) values ('men', 'Men', 'Kurta, Baju Melayu and refined staples.', false, 1);
insert into collections (slug, title, description, is_smart, sort_order) values ('accessories', 'Accessories', 'Shawls, inners and finishing touches.', false, 2);
insert into collections (slug, title, description, is_smart, sort_order) values ('best-sellers', 'Best Sellers', 'The pieces our community loves most.', true, 3);
insert into collections (slug, title, description, is_smart, sort_order) values ('new-arrivals', 'New Arrivals', 'Fresh from the Kalima atelier.', true, 4);
insert into collections (slug, title, description, is_smart, sort_order) values ('maya', 'Maya Collection', 'Luxury chiffon. Effortless elegance. Crafted with premium fabric.', false, 5);
insert into collections (slug, title, description, is_smart, sort_order) values ('amanda', 'Amanda Collection', 'Soft shimmer for celebration days.', false, 6);
insert into collections (slug, title, description, is_smart, sort_order) values ('luna', 'Luna Series', 'Evening silhouettes with quiet drama.', false, 7);
insert into collections (slug, title, description, is_smart, sort_order) values ('raya', 'Raya Collection', 'For every beautiful homecoming.', false, 8);
insert into collections (slug, title, description, is_smart, sort_order) values ('signature', 'Signature', 'Maya, Amanda and Luna — the Kalima signatures.', true, 9);

-- Products
insert into products (slug, name, description, fabric, category, price_sen, best_seller, new_arrival, tone) values
  ('maya-luna', 'Maya Luna', 'An evening abaya cut for movement — flowing luxury chiffon with a soft matte finish, subtle embroidered cuffs and a full modest silhouette.', 'Premium luxury chiffon, double-lined', 'women'::product_category, 29500, true, false, '#2b2733'),
  ('maya-chiffon', 'Maya Chiffon', 'The signature Maya drape. Effortless elegance in luxury chiffon, crafted with premium fabric and finished with hand-rolled hems.', 'Luxury chiffon, breathable inner lining', 'women'::product_category, 25000, true, true, '#e7cfc7'),
  ('amanda-sparkle', 'Amanda Sparkle', 'The city dress — a fitted mock-neck maxi in heavyweight ribbed jersey that skims without clinging. From gallery mornings to dinner, one piece.', 'Ribbed jersey with stretch, fully opaque', 'women'::product_category, 25000, true, false, '#1f1d20'),
  ('bella-dress', 'Bella Dress', 'Heritage, reimagined — a beaded lace kebaya in deep maroon over a flowing batik-print skirt. Made for Raya mornings and wedding evenings alike.', 'Beaded lace kebaya top with batik-print skirt', 'women'::product_category, 28900, true, true, '#6b2231'),
  ('sofea-dress', 'Sofea Dress', 'Soft watercolour blooms on ivory crepe — the Sofea falls straight and graceful with a gently structured shoulder. Quietly romantic, endlessly wearable.', 'Watercolour floral crepe, puff shoulder', 'women'::product_category, 26900, true, true, '#ece2d4'),
  ('ruwa-kaftan', 'Ruwa Kaftan', 'The Ruwa gathers light — satin blooms in peach, lilac and powder blue, finished with French lace bell sleeves. A kaftan that dresses up as easily as it lounges.', 'Satin floral with French lace bell sleeves', 'women'::product_category, 25900, true, true, '#e8c9b8'),
  ('cardigan-premium', 'Cardigan Premium', 'The everyday layer — a longline premium cardigan in a heavyweight knit that drapes without clinging, from desk to dinner.', 'Heavyweight ribbed knit', 'women'::product_category, 21000, true, false, '#8e8a85'),
  ('stretchable-rayon-inner', 'Stretchable Rayon Inner', 'The essential inner — buttery-soft stretchable rayon with full coverage and a snag-free finish. The one you re-buy in every shade.', '4-way stretch premium rayon', 'accessories'::product_category, 5000, true, false, '#5c4033'),
  ('maya-satin-shawl', 'Maya Satin Shawl', 'A matte satin shawl with the perfect weight for shaping — no slip, no shine overload, finished with baby hems.', 'Matte satin silk blend', 'accessories'::product_category, 8900, false, true, '#e2cdb2'),
  ('kurta-rifqi', 'Kurta Rifqi', 'A modern kurta in breathable cotton-linen — band collar, concealed placket, tailored through the shoulder with room to move.', 'Cotton-linen blend', 'men'::product_category, 18000, true, false, '#3b4636'),
  ('baju-melayu-teluk-belanga', 'Baju Melayu Teluk Belanga', 'Raya-ready Baju Melayu in premium cotton silk — Teluk Belanga neckline, matching trousers, unshakeable structure through the day.', 'Premium cotton silk', 'men'::product_category, 26000, false, true, '#383c61'),
  ('raya-kurung-seri', 'Kurung Seri', 'The Raya centrepiece — a modern kurung in songket-inspired jacquard with a soft metallic thread, cut long and graceful.', 'Songket-inspired jacquard', 'women'::product_category, 32000, false, true, '#8d99b5'),
  ('luna-palazzo', 'Luna Palazzo', 'Wide-leg palazzo in heavy crepe — opaque, uncrushable, with a comfort waistband that holds its line through travel days.', 'Heavy crepe, high waist', 'women'::product_category, 15000, false, false, '#1f1d20');

-- Variants: colour × size per product
with spec (slug, colors, sizes) as (values
  ('maya-luna', '[{"name":"Noir","hex":"#1f1d20"},{"name":"Blush","hex":"#d8a8a0"},{"name":"Mauve","hex":"#b98d95"}]'::jsonb, array['XS', 'S', 'M', 'L', 'XL', '2XL']::text[]),
  ('maya-chiffon', '[{"name":"Blush Floral","hex":"#e7cfc7"},{"name":"Sage","hex":"#a9b39b"},{"name":"Ivory","hex":"#efe9dd"},{"name":"Taupe","hex":"#b3a294"}]'::jsonb, array['XS', 'S', 'M', 'L', 'XL', '2XL']::text[]),
  ('amanda-sparkle', '[{"name":"Noir","hex":"#1f1d20"},{"name":"Olive","hex":"#5b6247"},{"name":"Mauve","hex":"#b28c96"}]'::jsonb, array['S', 'M', 'L', 'XL']::text[]),
  ('bella-dress', '[{"name":"Maroon","hex":"#6b2231"},{"name":"Midnight","hex":"#383c61"},{"name":"Emerald","hex":"#2f5d50"}]'::jsonb, array['XS', 'S', 'M', 'L', 'XL', '2XL']::text[]),
  ('sofea-dress', '[{"name":"Ivory Floral","hex":"#ece2d4"},{"name":"Blush","hex":"#d8b4ad"},{"name":"Sage","hex":"#a9b39b"}]'::jsonb, array['XS', 'S', 'M', 'L', 'XL', '2XL']::text[]),
  ('ruwa-kaftan', '[{"name":"Peach Bloom","hex":"#e8c9b8"},{"name":"Lilac","hex":"#c5b3d6"},{"name":"Powder Blue","hex":"#b9c8d6"}]'::jsonb, array['S', 'M', 'L', 'XL', '2XL']::text[]),
  ('cardigan-premium', '[{"name":"Stone","hex":"#8e8a85"},{"name":"Sage","hex":"#a9b39b"},{"name":"Mauve","hex":"#b98d95"}]'::jsonb, array['S', 'M', 'L', 'XL', '2XL']::text[]),
  ('stretchable-rayon-inner', '[{"name":"Noir","hex":"#1f1d20"},{"name":"Cocoa","hex":"#7a5c4e"},{"name":"Chestnut","hex":"#5c4033"}]'::jsonb, array['Free Size']::text[]),
  ('maya-satin-shawl', '[{"name":"Champagne","hex":"#e2cdb2"},{"name":"Sage","hex":"#a9b39b"},{"name":"Dusty Rose","hex":"#c99b98"}]'::jsonb, array['Free Size']::text[]),
  ('kurta-rifqi', '[{"name":"Forest","hex":"#3b4636"},{"name":"Ivory","hex":"#efe9dd"},{"name":"Navy","hex":"#383c61"}]'::jsonb, array['S', 'M', 'L', 'XL', '2XL', '3XL']::text[]),
  ('baju-melayu-teluk-belanga', '[{"name":"Navy","hex":"#383c61"},{"name":"Emerald","hex":"#2f5d50"},{"name":"Sand","hex":"#cbb89d"}]'::jsonb, array['S', 'M', 'L', 'XL', '2XL', '3XL']::text[]),
  ('raya-kurung-seri', '[{"name":"Pearl","hex":"#e8e2d6"},{"name":"Sage","hex":"#a9b39b"},{"name":"Dusty Blue","hex":"#8d99b5"}]'::jsonb, array['XS', 'S', 'M', 'L', 'XL', '2XL']::text[]),
  ('luna-palazzo', '[{"name":"Noir","hex":"#1f1d20"},{"name":"Stone","hex":"#8e8a85"}]'::jsonb, array['S', 'M', 'L', 'XL']::text[])
)
insert into product_variants (product_id, sku, color_name, color_hex, size, color_position, position)
select
  p.id,
  'KLM-' || upper(p.slug)
        || '-' || upper(regexp_replace(c.obj ->> 'name', '[^A-Za-z0-9]', '', 'g'))
        || '-' || upper(regexp_replace(s.size, '[^A-Za-z0-9]', '', 'g')),
  c.obj ->> 'name',
  c.obj ->> 'hex',
  s.size,
  c.cord - 1,
  s.ord - 1
from spec
join products p on p.slug = spec.slug
cross join lateral jsonb_array_elements(spec.colors) with ordinality as c(obj, cord)
cross join lateral unnest(spec.sizes) with ordinality as s(size, ord);

-- Images
insert into product_images (product_id, url, alt, color_name, position) values
  ((select id from products where slug = 'maya-chiffon'), '/products/maya-chiffon.jpg', 'Maya Chiffon', null, 0),
  ((select id from products where slug = 'amanda-sparkle'), '/products/amanda-sparkle.jpg', 'Amanda Sparkle', null, 0),
  ((select id from products where slug = 'bella-dress'), '/products/bella-dress.jpg', 'Bella Dress', null, 0),
  ((select id from products where slug = 'sofea-dress'), '/products/sofea-dress.jpg', 'Sofea Dress', null, 0),
  ((select id from products where slug = 'ruwa-kaftan'), '/products/ruwa-kaftan.jpg', 'Ruwa Kaftan', null, 0),
  ((select id from products where slug = 'ruwa-kaftan'), '/products/ruwa-kaftan.jpg', 'Ruwa Kaftan — Peach Bloom', 'Peach Bloom', 1),
  ((select id from products where slug = 'ruwa-kaftan'), '/products/ruwa-kaftan-lilac.jpg', 'Ruwa Kaftan — Lilac', 'Lilac', 2),
  ((select id from products where slug = 'ruwa-kaftan'), '/products/ruwa-kaftan-blue.jpg', 'Ruwa Kaftan — Powder Blue', 'Powder Blue', 3);

-- Curated collection membership (smart collections derive from flags instead)
insert into collection_products (collection_id, product_id, sort_order) values
  ((select id from collections where slug = 'women'), (select id from products where slug = 'maya-luna'), 0),
  ((select id from collections where slug = 'women'), (select id from products where slug = 'maya-chiffon'), 1),
  ((select id from collections where slug = 'women'), (select id from products where slug = 'amanda-sparkle'), 2),
  ((select id from collections where slug = 'women'), (select id from products where slug = 'bella-dress'), 3),
  ((select id from collections where slug = 'women'), (select id from products where slug = 'sofea-dress'), 4),
  ((select id from collections where slug = 'women'), (select id from products where slug = 'ruwa-kaftan'), 5),
  ((select id from collections where slug = 'women'), (select id from products where slug = 'cardigan-premium'), 6),
  ((select id from collections where slug = 'women'), (select id from products where slug = 'raya-kurung-seri'), 7),
  ((select id from collections where slug = 'women'), (select id from products where slug = 'luna-palazzo'), 8);
insert into collection_products (collection_id, product_id, sort_order) values
  ((select id from collections where slug = 'men'), (select id from products where slug = 'kurta-rifqi'), 0),
  ((select id from collections where slug = 'men'), (select id from products where slug = 'baju-melayu-teluk-belanga'), 1);
insert into collection_products (collection_id, product_id, sort_order) values
  ((select id from collections where slug = 'accessories'), (select id from products where slug = 'stretchable-rayon-inner'), 0),
  ((select id from collections where slug = 'accessories'), (select id from products where slug = 'maya-satin-shawl'), 1);
insert into collection_products (collection_id, product_id, sort_order) values
  ((select id from collections where slug = 'maya'), (select id from products where slug = 'maya-chiffon'), 0),
  ((select id from collections where slug = 'maya'), (select id from products where slug = 'sofea-dress'), 1),
  ((select id from collections where slug = 'maya'), (select id from products where slug = 'maya-satin-shawl'), 2);
insert into collection_products (collection_id, product_id, sort_order) values
  ((select id from collections where slug = 'amanda'), (select id from products where slug = 'amanda-sparkle'), 0),
  ((select id from collections where slug = 'amanda'), (select id from products where slug = 'ruwa-kaftan'), 1);
insert into collection_products (collection_id, product_id, sort_order) values
  ((select id from collections where slug = 'luna'), (select id from products where slug = 'maya-luna'), 0),
  ((select id from collections where slug = 'luna'), (select id from products where slug = 'luna-palazzo'), 1);
insert into collection_products (collection_id, product_id, sort_order) values
  ((select id from collections where slug = 'raya'), (select id from products where slug = 'bella-dress'), 0),
  ((select id from collections where slug = 'raya'), (select id from products where slug = 'baju-melayu-teluk-belanga'), 1),
  ((select id from collections where slug = 'raya'), (select id from products where slug = 'raya-kurung-seri'), 2);

commit;
