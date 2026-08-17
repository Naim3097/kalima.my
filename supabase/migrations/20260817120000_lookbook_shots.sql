/*
  The homepage Lookbook, moved out of code and into the CMS.

  It was a hardcoded SHOTS array in src/components/home/Lookbook.tsx, so
  changing which pieces appeared meant a deploy — while the announcement bar,
  hero slides and content pages beside it were all editable in Admin → Content.

  THE BUG THIS ALSO FIXES. Each shot's image was built by PATH CONVENTION:
  productPhoto(slug, colour) returns `product-images/<slug>/<colour>.jpg`. That
  is not how images are stored any more. Seeded photos do live at that path, but
  admin uploads go to `<productId>/<uuid>.jpg` (see createImageUploadUrl), so the
  Lookbook was reading storage objects that no product_images row points at.

  Every one of them still resolved, which is why nobody noticed. But they had
  come loose from the catalogue, and the fourth shot showed it: it asked for
  `anna-top/peony-garden`, and Anna Top has no "peony garden" colourway — its
  colours are Dusty Lily, Sunset Garden, Blue Orange and seven others. The tile
  advertised a print the product page no longer sells.

  A shot now names a product and one of ITS colourways, and the URL is resolved
  from the real product_images row at render time. A shot cannot reference a
  colourway that does not exist, and replacing a colour's photo updates the
  Lookbook with nothing else to do.
*/

create table lookbook_shots (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,

  /*
    Which colourway's photograph to show. Text rather than a variant reference:
    the photo belongs to a COLOURWAY, not to a size, and product_images is keyed
    by colour name the same way. A colour that is renamed orphans the shot, which
    the admin surfaces as "no photo" rather than hiding.
  */
  color_name text not null,

  /*
    Optional. Falls back to the product image's own alt, then to
    "<product> in <colour>" — so a shot always has something usable rather than
    an empty alt, which is worse for a screen reader than a plain description.
  */
  alt        text,

  sort_order integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/*
  The same product in the same colourway twice is not a second shot, it is a
  duplicate tile with nothing to tell them apart. Two DIFFERENT colourways of one
  product are fine and deliberately allowed.
*/
create unique index lookbook_shots_pair_idx on lookbook_shots (product_id, color_name);
create index lookbook_shots_order_idx on lookbook_shots (sort_order) where active;

create trigger lookbook_shots_updated_at before update on lookbook_shots
  for each row execute function set_updated_at();

-- =========================================================================
-- RLS
-- =========================================================================

alter table lookbook_shots enable row level security;

/*
  Public read only while the product is published — the same rule
  "addons follow their products" applies in 20260817030624. Unpublishing a
  product should withdraw it from every surface at once, and the homepage is a
  surface: a tile linking to a 404 is worse than one tile fewer.
*/
create policy "lookbook shots follow their product" on lookbook_shots for select
  using (
    exists (select 1 from products p where p.id = product_id and p.published)
  );

create policy "staff manage lookbook shots" on lookbook_shots for all
  using ((select private.is_staff())) with check ((select private.is_staff()));

grant select on lookbook_shots to anon, authenticated;

-- =========================================================================
-- Seed: the five shots that were in the code
-- =========================================================================

/*
  Seeded by slug + colour so the homepage is unchanged on deploy, and joined
  against product_images so a pair that has no photograph simply does not insert
  rather than becoming a blank tile.

  FOUR MAP EXACTLY. The fifth does not, and the substitution is recorded here
  rather than left as a silent difference: the code asked for Anna Top in
  "peony-garden", which is not one of its colourways, so this seeds Anna Top in
  DUSTY LILY. Change it in Admin → Content → Lookbook if another colour suits
  the row better — that is now a two-click decision rather than a deploy.
*/
insert into lookbook_shots (product_id, color_name, alt, sort_order)
select p.id, s.color_name, s.alt, s.sort_order
  from (values
    ('ruwa-caftan',   'Burgundy',   'Ruwa Caftan in burgundy satin',                       0),
    ('danisya-set',   'Magenta',    'Danisya Set in magenta satin',                        1),
    ('serra-scallop', 'Teal Green', 'Serra Scallop cardigan abaya in teal green',          2),
    ('anna-top',      'Dusty Lily', 'Anna Top in the Dusty Lily print',                    3),
    ('luna-palazzo',  'Sand',       'Luna Palazo in sand',                                 4)
  ) as s(slug, color_name, alt, sort_order)
  join products p on p.slug = s.slug
 where exists (
   select 1 from product_images i
    where i.product_id = p.id and i.color_name = s.color_name
 )
on conflict do nothing;
