/*
  Phase 3 CMS — client-editable storefront content: the announcement bar, the
  hero carousel, and the content pages (About, Fabrics, policies…). Same model
  as the catalog: public read of published rows, staff-only writes.

  Seed data (the current hardcoded content) is applied live/out-of-band; this
  file is the schema. Nav manager, USP strip, spotlight and store locations
  stay hardcoded for now — later CMS passes.
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
  body       jsonb not null default '[]'::jsonb,  -- array of paragraphs
  published  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table content_pages enable row level security;
create trigger content_pages_updated_at before update on content_pages
  for each row execute function set_updated_at();

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
