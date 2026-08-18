/*
  The homepage Lookbook, fed from Instagram instead of by hand.

  One row per Instagram media, refreshed daily by src/lib/instagram/sync.ts.

  `image` and `storage_path` point at OUR mirrored copy, never at Instagram's
  CDN. Instagram's media URLs are signed and expire within days, so a row that
  stored the CDN URL would render a broken tile shortly after it was written.
  Mirroring also keeps the section up when Meta's API is down, and keeps every
  storefront image on a host next.config.ts already trusts.

  `product_id` is the optional tag that keeps this section shoppable: tagged
  posts link to the product page, untagged ones open the post on Instagram.
  ON DELETE SET NULL — retiring a product must untag the post, not delete the
  photograph off the homepage.

  `hidden` is for a post that belongs on Instagram but not on the storefront.
  It is staff-only rather than deleted because the sync would just fetch it
  again on the next run.
*/
create table instagram_posts (
  id           text primary key,
  permalink    text not null,
  caption      text,
  media_type   text not null,
  image        text not null,
  storage_path text not null,
  posted_at    timestamptz not null,
  product_id   uuid references products(id) on delete set null,
  hidden       boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

/* The storefront reads newest-first and skips hidden rows. */
create index instagram_posts_visible_idx on instagram_posts (posted_at desc) where not hidden;

alter table instagram_posts enable row level security;
create trigger instagram_posts_updated_at before update on instagram_posts
  for each row execute function set_updated_at();

create policy "visible instagram posts are public" on instagram_posts for select
  using (not hidden or (select private.is_staff()));
create policy "staff manage instagram posts" on instagram_posts for all
  using ((select private.is_staff())) with check ((select private.is_staff()));

grant select on instagram_posts to anon, authenticated;
