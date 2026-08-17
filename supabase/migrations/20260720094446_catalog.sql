-- Kalima — catalog domain
-- PROJECT_PLAN.md §5 "Catalog". Phase 2 swaps src/data/catalog.ts onto these tables.

/*
  IDs use gen_random_uuid(), NOT uuid_generate_v4(). Do not "restore" the latter.

  uuid-ossp lives in the `extensions` schema, and `supabase db push` applies
  migrations with a narrower search_path than the database default — so an
  unqualified uuid_generate_v4() resolves in the dashboard and dies on a fresh
  `db push` with "function uuid_generate_v4() does not exist". That made this
  whole migration set unreplayable: it only ever worked because production was
  built up statement by statement rather than pushed from scratch, and it failed
  on the first file the moment a second project was created.

  gen_random_uuid() is in pg_catalog, always in scope, and needs no extension.
  20260722060902 already reached this conclusion for the commerce tables and
  explains the same reasoning for SECURITY DEFINER functions with search_path='';
  this brings the earlier files in line so a fresh database can be built from the
  migrations alone.

  The extension itself is left installed below: harmless, and other Supabase
  machinery may expect it.
*/
create extension if not exists "uuid-ossp";

create type product_category as enum ('women', 'men', 'accessories');

create table collections (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  title       text not null,
  description text,
  -- Curated collections list members in collection_products; "smart" ones
  -- (Best Sellers, New Arrivals) are derived from product flags instead.
  is_smart    boolean not null default false,
  sort_order  integer not null default 0,
  published   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index collections_slug_idx on collections (slug) where published;

create table products (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null,
  description  text,
  fabric       text,
  category     product_category not null,
  -- Base price in sen (integer money — never float; §4.2 "money integrity").
  price_sen    integer not null check (price_sen >= 0),
  best_seller  boolean not null default false,
  new_arrival  boolean not null default false,
  -- Fallback gradient tone used by PlaceholderImage until photography lands (§8).
  tone         text not null default '#383c61',
  published    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index products_category_idx on products (category) where published;
create index products_best_seller_idx on products (best_seller) where published and best_seller;
create index products_new_arrival_idx on products (new_arrival) where published and new_arrival;

-- Postgres full-text search, replacing the client-side name match in the
-- search overlay (Phase 1 note in PROJECT_PLAN.md §6).
alter table products
  add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) stored;

create index products_search_idx on products using gin (search_vector);

create table collection_products (
  collection_id uuid not null references collections (id) on delete cascade,
  product_id    uuid not null references products (id) on delete cascade,
  sort_order    integer not null default 0,
  primary key (collection_id, product_id)
);

-- Variants — the SKU grain. Stock lives here and only here (§4.2).
create table product_variants (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products (id) on delete cascade,
  sku           text not null unique,
  color_name    text not null,
  color_hex     text not null,
  size          text not null,
  -- Null means "inherit the product's base price"; set to override per variant.
  price_sen     integer check (price_sen >= 0),
  -- Grams, for EasyParcel rate quotes (Phase 4).
  weight_grams  integer not null default 0 check (weight_grams >= 0),
  stock_on_hand integer not null default 0 check (stock_on_hand >= 0),
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (product_id, color_name, size)
);

create index product_variants_product_idx on product_variants (product_id);

-- Images — product-level, optionally scoped to one colourway.
-- A per-colour row drives the swatch-click photo swap (Ruwa Kaftan, Phase 1).
create table product_images (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  -- Supabase Storage object path, or a /public path during the seed phase.
  url        text not null,
  alt        text,
  color_name text,
  position   integer not null default 0,
  -- Suggested object-position, e.g. 'center 14%' for high-framed standing shots.
  focal      text,
  created_at timestamptz not null default now()
);

create index product_images_product_idx on product_images (product_id, position);

-- updated_at maintenance
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger collections_updated_at
  before update on collections
  for each row execute function set_updated_at();

create trigger products_updated_at
  before update on products
  for each row execute function set_updated_at();

create trigger product_variants_updated_at
  before update on product_variants
  for each row execute function set_updated_at();

-- Row Level Security — §4.2 "RLS everywhere"
alter table collections         enable row level security;
alter table collection_products enable row level security;
alter table products            enable row level security;
alter table product_variants    enable row level security;
alter table product_images      enable row level security;

/*
  security definer + a pinned empty search_path: the function resolves
  `auth.jwt` itself rather than depending on the caller's grants on the auth
  schema or on a search_path an attacker could shadow.
*/
create or replace function public.is_staff()
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

grant execute on function public.is_staff() to anon, authenticated;

-- Public read of published catalog. is_staff() is wrapped in a scalar
-- subquery so it is evaluated once per query, not once per row.
create policy "published collections are public"
  on collections for select
  using (published or (select public.is_staff()));

create policy "published products are public"
  on products for select
  using (published or (select public.is_staff()));

create policy "variants follow their product"
  on product_variants for select
  using (
    exists (
      select 1 from products p
      where p.id = product_variants.product_id
        and (p.published or (select public.is_staff()))
    )
  );

create policy "images follow their product"
  on product_images for select
  using (
    exists (
      select 1 from products p
      where p.id = product_images.product_id
        and (p.published or (select public.is_staff()))
    )
  );

create policy "collection membership follows its collection"
  on collection_products for select
  using (
    exists (
      select 1 from collections c
      where c.id = collection_products.collection_id
        and (c.published or (select public.is_staff()))
    )
  );

-- Writes: staff/admin only.
create policy "staff manage collections"         on collections         for all using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "staff manage collection_products" on collection_products for all using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "staff manage products"            on products            for all using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "staff manage product_variants"    on product_variants    for all using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "staff manage product_images"      on product_images      for all using ((select public.is_staff())) with check ((select public.is_staff()));
