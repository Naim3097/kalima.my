/*
  The footer, made editable — and the company's registration number put on it.

  Malaysian companies must identify themselves on their commercial
  communications, and the number was only in the privacy policy prose. It now
  has a field of its own, seeded from that policy so the two cannot say
  different things.

  THREE SHAPES, because the footer is three different kinds of content:

    store_settings   the one-of-a-kind text — company name, registration
                     number, the tagline under the logo, the payment note. A
                     singleton row already exists for shop-wide settings and
                     these belong with it rather than in a table of one.

    footer_trust     the four-across strip. An ICON KEY, not markup: the
                     storefront maps it to a component from a fixed set, so an
                     editor picks from what exists and cannot paste an <svg>
                     into the page.

    footer_link_columns / footer_links
                     navigation, which is a list of lists. Two tables rather
                     than a heading repeated on every row, so renaming a column
                     is one edit and cannot half-apply.

  SEEDED with exactly what the component hardcoded, so this migration changes
  nothing on screen and the admin screen is usable the moment it opens. The
  component keeps its constants as the fallback for an unconfigured Supabase.
*/

alter table store_settings
  add column company_name    text,
  add column company_reg_no  text,
  add column footer_tagline  text,
  add column footer_payment_note text;

update store_settings set
  company_name        = 'KALIMA GROUP TRADING (M) SDN. BHD.',
  company_reg_no      = '202101012868 (1413167-V)',
  footer_tagline      = 'Timeless modest luxury — designed in Malaysia for every beautiful journey.',
  footer_payment_note = 'FPX · Visa · Mastercard · GrabPay — secure checkout'
where id = 1;

/* ---- Trust strip --------------------------------------------------------- */

create table footer_trust (
  id         uuid primary key default gen_random_uuid(),
  icon       text not null,
  title      text not null,
  body       text,
  sort_order integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table footer_trust enable row level security;
create trigger footer_trust_updated_at before update on footer_trust
  for each row execute function set_updated_at();

create policy "active footer trust is public" on footer_trust for select
  using (active or (select private.is_staff()));
create policy "staff manage footer trust" on footer_trust for all
  using ((select private.is_staff())) with check ((select private.is_staff()));

insert into footer_trust (icon, title, body, sort_order) values
  ('truck',   'Worldwide Delivery', 'Rates shown at checkout', 0),
  ('return',  'Easy Returns',       '14 days return policy',   1),
  ('shield',  'Secure Payment',     '100% secure checkout',    2),
  ('headset', 'Customer Support',   'We''re here to help',     3);

/* ---- Link columns -------------------------------------------------------- */

create table footer_link_columns (
  id         uuid primary key default gen_random_uuid(),
  heading    text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table footer_links (
  id         uuid primary key default gen_random_uuid(),
  column_id  uuid not null references footer_link_columns(id) on delete cascade,
  label      text not null,
  href       text not null,
  sort_order integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index footer_links_column_idx on footer_links (column_id, sort_order);

alter table footer_link_columns enable row level security;
alter table footer_links enable row level security;
create trigger footer_link_columns_updated_at before update on footer_link_columns
  for each row execute function set_updated_at();
create trigger footer_links_updated_at before update on footer_links
  for each row execute function set_updated_at();

create policy "footer columns are public" on footer_link_columns for select using (true);
create policy "staff manage footer columns" on footer_link_columns for all
  using ((select private.is_staff())) with check ((select private.is_staff()));

create policy "active footer links are public" on footer_links for select
  using (active or (select private.is_staff()));
create policy "staff manage footer links" on footer_links for all
  using ((select private.is_staff())) with check ((select private.is_staff()));

grant select on footer_trust, footer_link_columns, footer_links to anon, authenticated;

/* Seeded from the component, link for link. */
with cols as (
  insert into footer_link_columns (heading, sort_order) values
    ('Shop', 0), ('Help', 1), ('Kalima', 2)
  returning id, heading
)
insert into footer_links (column_id, label, href, sort_order)
select c.id, l.label, l.href, l.sort_order
from cols c
join (values
  ('Shop', 'Women',              '/collections/women',         0),
  ('Shop', 'Men',                '/collections/men',           1),
  ('Shop', 'Accessories',        '/collections/accessories',   2),
  ('Shop', 'New Arrivals',       '/collections/new-arrivals',  3),
  ('Shop', 'Best Sellers',       '/collections/best-sellers',  4),
  ('Help', 'Shipping',           '/pages/shipping',            0),
  ('Help', 'Returns & Exchanges','/pages/returns',             1),
  ('Help', 'Size Guide',         '/pages/size-guide',          2),
  ('Help', 'Custom Sizing',      '/pages/custom-sizing',       3),
  ('Help', 'Contact Us',         '/pages/contact',             4),
  ('Help', 'Privacy Policy',     '/pages/privacy',             5),
  ('Kalima', 'About Kalima',     '/pages/about-kalima',        0),
  ('Kalima', 'Our Fabrics',      '/pages/fabrics',             1),
  ('Kalima', 'Stores',           '/pages/stores',              2),
  ('Kalima', 'Kalima Club',      '/kalima-club',               3),
  ('Kalima', 'Refer a Friend',   '/affiliate',                 4),
  ('Kalima', 'My Account',       '/account',                   5)
) as l(heading, label, href, sort_order) on l.heading = c.heading;
