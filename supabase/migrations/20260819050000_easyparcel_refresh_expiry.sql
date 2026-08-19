/*
  Records when the EasyParcel CONNECTION lapses, not just the access token.

  easyparcel_token_expires is the access token — ten hours, refreshed silently
  whenever a checkout needs it. Nobody needs to see that. What matters is the
  refresh token behind it, which EasyParcel issues for about a year: when that
  goes, the connection is gone and no overseas customer can be quoted until
  somebody clicks Connect again.

  Until now that date existed nowhere. The response carried it
  (refresh_token_expires_in) and we dropped it on the floor, so the only way to
  discover the connection had died was a customer failing to check out. Kept
  here so the Shipping screen can say it out loud, months ahead.

  Nullable: connections made before this migration have no recorded date, and a
  blank is the honest rendering of "we do not know" — better than inventing one
  a year from today.
*/
alter table store_settings
  add column easyparcel_refresh_expires timestamptz;
