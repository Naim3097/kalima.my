/*
  Matching add-ons, and per-product custom sizing.

  ADD-ONS ARE NOT A NEW KIND OF THING. A "matching pants" add-on is already a
  product in its own right: its own SKUs, its own stock, its own marketplace
  listings, sold separately on its own PDP. So this migration adds no line
  format, no price field and no stock path — only a LINK saying "offer this
  product alongside that one, in this colourway".

  Everything downstream then works untouched. order_items is at the variant
  grain and create_order takes [{variant_id, qty}], so a ticked add-on is
  simply a second cart line: it is priced by create_order, decremented by
  mark_order_paid, released by refund_order, and pushed to Shopee/TikTok by the
  stock_movements trigger — none of which needs to know the concept exists.

  That is the whole design. A jsonb "add_ons" blob hung off order_items would
  have been quicker to write and would have bypassed every one of those paths,
  which is how you end up selling stock you do not have.
*/

-- =========================================================================
-- The link
-- =========================================================================

create table product_addons (
  id                uuid primary key default gen_random_uuid(),
  parent_product_id uuid not null references products (id) on delete cascade,
  addon_product_id  uuid not null references products (id) on delete cascade,

  /*
    Which colourway of the add-on counts as "matching".

    Pinned by staff rather than mirrored from the parent's selected colour:
    "matching" is a merchandising judgement, not a string comparison. A Cherry
    abaya may pair with Black pants, and even when the two do share a colour
    the names need only differ by a space ("Off White" vs "Off-White") for a
    mirror to resolve to nothing and silently drop the add-on.

    Null means "the add-on's first colourway by position", so a single-colour
    add-on needs no configuration at all.
  */
  addon_color_name  text,

  /*
    Display override, e.g. "Matching Palazzo Pants" where the product itself is
    listed as "Palazzo Pants". Null falls back to the add-on product's name, so
    a renamed product cannot leave a stale label behind.
  */
  label             text,

  sort_order        integer not null default 0,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  /*
    A product cannot be its own add-on. Without this, ticking the box would add
    a second line of the item already in the bag — and the PDP would offer it
    while the shopper was standing on it.
  */
  constraint product_addons_not_self check (parent_product_id <> addon_product_id)
);

/*
  One link per pair. Two rows for the same pair would render the same add-on
  twice on the PDP with no way for the shopper to tell them apart. Staff who
  want a different colourway edit the row rather than adding another.
*/
create unique index product_addons_pair_idx
  on product_addons (parent_product_id, addon_product_id);

create index product_addons_parent_idx
  on product_addons (parent_product_id, sort_order);

create trigger product_addons_updated_at before update on product_addons
  for each row execute function set_updated_at();

-- =========================================================================
-- RLS
-- =========================================================================

alter table product_addons enable row level security;

/*
  BOTH ends must be published, not just the parent.

  The parent check is the obvious one — it mirrors "images follow their
  product" in 20260720094446. The add-on check is the one that matters: an
  unpublished add-on product is one whose PDP returns 404, so offering it as a
  tickbox would put an unbuyable line in the bag that checkout then rejects at
  resolveCartLines. Unpublishing a product should withdraw it from every
  surface at once, including this one.
*/
create policy "addons follow their products" on product_addons for select
  using (
    exists (select 1 from products p where p.id = parent_product_id and p.published)
    and exists (select 1 from products a where a.id = addon_product_id and a.published)
  );

create policy "staff manage product_addons" on product_addons for all
  using ((select private.is_staff())) with check ((select private.is_staff()));

grant select on product_addons to anon, authenticated;

-- =========================================================================
-- Custom sizing
-- =========================================================================

/*
  Whether this piece can actually be tailored.

  Per-product rather than site-wide: the link invites a DM, and an invitation
  on an accessory or a fixed-cut piece produces enquiries the team then has to
  turn down. Defaults false, so the link appears only where someone has said it
  should.
*/
alter table products add column offers_custom_sizing boolean not null default false;

/*
  The WhatsApp number the custom-sizing page points at, alongside the four
  social profiles from 20260813064250. Configured rather than written into the
  page copy, so changing it does not mean editing prose in two places.
*/
alter table store_settings add column social_whatsapp text;

/*
  GRANTS ARE COLUMN-SCOPED ON BOTH TABLES, so a new column is invisible to the
  storefront until it is named here.

  store_settings was narrowed by 20260723103945 when the EasyParcel token moved
  in, and products carries a column list too. 20260813071446 exists solely
  because the social columns were added without this step and the footer read
  came back empty. Same trap, same remedy — and note a column grant is a
  separate grant, not a replacement, so this neither restates nor narrows the
  existing lists.
*/
grant select (offers_custom_sizing) on public.products       to anon, authenticated;
grant select (social_whatsapp)      on public.store_settings to anon, authenticated;

-- =========================================================================
-- The custom-sizing page
-- =========================================================================

/*
  Seeded as a CMS row so staff can edit the terms — the 2–3 week lead time and
  the no-exchange condition are commercial policy and will change without a
  deploy. The route carries the same copy as a hardcoded fallback, so the page
  renders even against a database where this row was never inserted.

  The Instagram handle and WhatsApp number are deliberately NOT in this text.
  The page renders them as buttons from store_settings, so they stay correct in
  one place rather than being restated in prose here.
*/
insert into content_pages (slug, title, body, published)
values (
  'custom-sizing',
  'Custom Sizing',
  to_jsonb(array[
    'Looking for a tailored fit? We offer custom sizing on request — just DM us on Instagram or WhatsApp us with your measurements and preferred style, and we’ll confirm fabric and style availability.',
    'Please note: custom orders take up to 2–3 weeks and are not eligible for exchange.'
  ]),
  true
)
on conflict (slug) do nothing;
