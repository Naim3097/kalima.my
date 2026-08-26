/*
  Which couriers overseas shoppers may pick — the international counterpart of
  domestic_allowed_couriers, same matching rule (case-insensitive, against the
  courier and service names). "Ninja" rather than "Ninjavan" because EasyParcel
  names the company "Ninja Logistics Sdn Bhd" and the service "Ninjavan -
  International"; the shorter needle finds both. Empty = every pickup courier.
*/
alter table store_settings
  add column international_allowed_couriers text[] not null
    default array['Ninja', 'Aramex', 'UPS', 'DHL'];
