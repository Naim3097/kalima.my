/*
  The homepage's hand-picked editorial shots, made editable.

  The category tiles and the collection spotlight BUILD their image URL in code
  from a slug and a colourway (src/lib/images.ts), which is why changing either
  photograph has meant a deploy — and why they are the shots that break on
  staging, where the copied catalogue points at a bucket staging cannot write.

  One row per SLOT rather than a table of tiles: the tiles themselves (label,
  link, position on the page) are layout, and layout belongs in the component.
  What an editor needs to change is the photograph and how it is framed.

  Framing carries the same two values as hero_slides, for the same reason: these
  frames are fixed-aspect and full-bleed, so `focal` places the photo and `zoom`
  crops into it, leaving the upload itself untouched and re-editable.

  Deliberately NOT seeded. A missing row means "use the shot the code already
  picks", so this migration changes nothing until someone uploads — and both
  environments keep rendering exactly what they render today.
*/
create table editorial_images (
  slot       text primary key,
  image      text not null,
  focal      text not null default 'center',
  zoom       real not null default 1 constraint editorial_images_zoom_range check (zoom >= 1 and zoom <= 3),
  alt        text,
  updated_at timestamptz not null default now()
);

alter table editorial_images enable row level security;
create trigger editorial_images_updated_at before update on editorial_images
  for each row execute function set_updated_at();

/* Public, unconditionally: a row only exists because staff put a photograph on
   the homepage, so there is no unpublished state to hide. */
create policy "editorial images are public" on editorial_images for select
  using (true);
create policy "staff manage editorial images" on editorial_images for all
  using ((select private.is_staff())) with check ((select private.is_staff()));

grant select on editorial_images to anon, authenticated;
