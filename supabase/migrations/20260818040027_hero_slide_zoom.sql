/*
  Hero slide framing lives on the row, not baked into the file.

  The homepage hero is full-bleed and changes shape between breakpoints — a tall
  panel on mobile, a wide one on desktop — so object-cover re-crops whatever it
  is handed. Cropping the uploaded JPEG therefore does not settle the framing,
  and it throws away the pixels outside the crop for good.

  So the full image is stored once and framed at render time: `focal` is the
  object-position (it already existed, as free text) and `zoom` scales the image
  around that point, cropping INTO the frame without discarding anything.
  Re-editable forever, and correct at every breakpoint.

  1 means "no zoom", so the default leaves every existing slide rendering
  exactly as it does today. The ceiling of 3 is roughly where a 2400px upload
  starts showing its own pixels.
*/
alter table hero_slides
  add column zoom real not null default 1
  constraint hero_slides_zoom_range check (zoom >= 1 and zoom <= 3);
