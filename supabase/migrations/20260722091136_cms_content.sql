/*
  Phase 3 CMS — client-editable storefront content: the announcement bar, the
  hero carousel, and the content pages (About, Fabrics, policies…). Same model
  as the catalog: public read of published rows, staff-only writes.

  Scope note: nav menu manager, USP strip, collection spotlight and store
  locations stay hardcoded for now — later CMS passes.
*/

create table announcements (
  id         uuid primary key default gen_random_uuid(),
  text       text not null,
  sort_order integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table announcements enable row level security;
create trigger announcements_updated_at before update on announcements
  for each row execute function set_updated_at();

create table hero_slides (
  id              uuid primary key default gen_random_uuid(),
  eyebrow         text,
  title           text not null,
  body            text,
  image           text not null,
  focal           text default 'center',
  primary_label   text,
  primary_href    text,
  secondary_label text,
  secondary_href  text,
  sort_order      integer not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table hero_slides enable row level security;
create trigger hero_slides_updated_at before update on hero_slides
  for each row execute function set_updated_at();

create table content_pages (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  title      text not null,
  -- Body is an array of paragraphs (jsonb), matching the storefront renderer.
  body       jsonb not null default '[]'::jsonb,
  published  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table content_pages enable row level security;
create trigger content_pages_updated_at before update on content_pages
  for each row execute function set_updated_at();

-- RLS: public read of published/active rows; staff manage.
create policy "active announcements are public" on announcements for select
  using (active or (select private.is_staff()));
create policy "staff manage announcements" on announcements for all
  using ((select private.is_staff())) with check ((select private.is_staff()));

create policy "active hero slides are public" on hero_slides for select
  using (active or (select private.is_staff()));
create policy "staff manage hero slides" on hero_slides for all
  using ((select private.is_staff())) with check ((select private.is_staff()));

create policy "published pages are public" on content_pages for select
  using (published or (select private.is_staff()));
create policy "staff manage content pages" on content_pages for all
  using ((select private.is_staff())) with check ((select private.is_staff()));

grant select on announcements, hero_slides, content_pages to anon, authenticated;

-- Seed from the current hardcoded content.
insert into announcements (text, sort_order) values
  ('FREE SHIPPING for orders above RM300', 0),
  ('New: The Maya Collection — luxury chiffon, effortless elegance', 1),
  ('Join Kalima Club for exclusive offers & private sales', 2);

insert into hero_slides (eyebrow, title, body, image, focal, primary_label, primary_href, secondary_label, secondary_href, sort_order) values
  ('New Collection', 'Timeless Modest Luxury', 'Designed in Malaysia for every beautiful journey.', '/products/maya-chiffon.jpg', 'center 38%', 'Shop Collection', '/collections/new-arrivals', 'New Arrivals', '/collections/new-arrivals', 0),
  ('The Maya Collection', 'Luxury Chiffon, Effortless Elegance', 'Crafted with premium fabric, finished by hand.', '/products/sofea-dress.jpg', 'center 30%', 'Discover Maya', '/collections/maya', 'Shop Women', '/collections/women', 1),
  ('Raya Collection', 'For Every Beautiful Homecoming', 'Kurung, kebaya and Baju Melayu for the whole family.', '/products/bella-dress.jpg', 'center 14%', 'Shop Raya', '/collections/raya', 'Shop Men', '/collections/men', 2);

insert into content_pages (slug, title, body) values
  ('about-kalima', 'About Kalima', '["Kalima is a Malaysian modest fashion house built on a simple belief: elegance and modesty belong together, without compromise.","Every piece is designed in-house in Malaysia, cut from premium fabrics we source and test ourselves, and made to travel with you through every beautiful journey — from everyday moments to the celebrations that matter."]'::jsonb),
  ('fabrics', 'Our Fabrics', '["We build each collection around fabric first — luxury chiffon with true drape, breathable cotton-linen, heavyweight crepe that holds its line, and 4-way stretch rayon for all-day ease.","Full fabric stories and care guides are being prepared for this page."]'::jsonb),
  ('stores', 'Stores', '["Our store locator is coming soon. Meanwhile, shop online with free shipping for orders above RM300 nationwide."]'::jsonb),
  ('shipping', 'Shipping', '["We ship nationwide (Semenanjung, Sabah & Sarawak) via trusted courier partners. Free shipping for orders above RM300.","Live courier rates and tracking arrive with our EasyParcel integration."]'::jsonb),
  ('returns', 'Returns & Exchanges', '["We offer a 14-day easy return policy from the day your order arrives. Items must be unworn with tags intact.","The full self-service returns portal is on its way."]'::jsonb),
  ('size-guide', 'Size Guide', '["Detailed measurement charts for every silhouette are being prepared. For now, our team is happy to help you size correctly — contact us."]'::jsonb),
  ('contact', 'Contact Us', '["Customer support channels (WhatsApp, email, social) will be listed here. We''re here to help."]'::jsonb),
  ('kalima-club', 'Kalima Club', '["Kalima Club is our loyalty membership — earn points on every purchase, unlock tiers, and enjoy exclusive offers and private sales.","Launching soon. Join the newsletter to be first in line."]'::jsonb);

select
  (select count(*) from announcements) as announcements,
  (select count(*) from hero_slides) as hero_slides,
  (select count(*) from content_pages) as pages;
