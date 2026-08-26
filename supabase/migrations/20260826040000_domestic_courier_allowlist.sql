/*
  Which couriers Malaysian shoppers may pick.

  EasyParcel quotes a dozen pickup services for any Semenanjung address, and
  the shop wants to offer exactly one — J&T — because that is the courier that
  actually collects here reliably. A setting rather than a constant: the
  moment a second courier is wanted it should be a field, not a deploy.

  Matched case-insensitively against the courier name AND the service name, so
  "J&T" finds "J&T Express (Malaysia) Sdn. Bhd." without anyone having to type
  the registered company name. Empty array = every pickup courier, as before.
  Overseas is not filtered — the international couriers are a different set.
*/
alter table store_settings
  add column domestic_allowed_couriers text[] not null default array['J&T'];
