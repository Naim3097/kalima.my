/*
  Removes shipping_quotes.

  It was built for a customer-facing courier picker: the client would receive a
  quote_id, and the server would later look the amount back up so a tampered
  browser could not choose its own shipping price.

  That flow is not what Kalima does. The customer is charged the store's flat
  rate (or free above the threshold), computed server-side by create_order as it
  already was. EasyParcel is an admin-side tool for booking the parcel without
  opening their website — rates are fetched live at booking time and chosen by
  staff, who are trusted, so there is nothing to freeze and nothing to defend
  against.

  Keeping the table would imply a checkout flow that does not exist.
*/
drop table if exists shipping_quotes;
