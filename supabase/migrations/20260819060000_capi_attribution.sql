/*
  What Meta needs to know about the SHOPPER, kept until the purchase settles.

  Purchase fires from runPaidSideEffects, which runs inside a payment webhook —
  a request made by LeanX from a datacentre, not by the customer from their
  phone. The IP address and User-Agent on that request belong to the gateway,
  and sending them would attach every conversion the shop makes to the wrong
  device, the wrong network and usually the wrong country. Meta would accept it
  all and report it confidently.

  The shopper's real values exist for exactly one moment — the request that
  places the order — so they are captured there and replayed when the money
  lands. Same for the two cookies src/proxy.ts mints, which the webhook never
  sees because the webhook carries no browser cookies at all.

  Nullable throughout: an order placed before this shipped has none of it, and
  Meta's user_data drops absent fields rather than being harmed by them. Also
  null for any order placed while the proxy has not yet set a cookie, which is
  a real first-visit case, not an error.
*/
alter table orders
  add column capi_fbp       text,
  add column capi_fbc       text,
  add column capi_client_ip text,
  add column capi_client_ua text;

/*
  Events Meta did not accept, kept so a conversion is not lost to one bad
  minute of network.

  The payload is stored ASSEMBLED, not as the arguments it was built from: a
  replay must send what was originally computed, since the order behind it may
  have been refunded or edited in the meantime, and re-deriving would report the
  new state under the original event's timestamp.

  SEVEN DAYS IS A HARD WALL. Meta rejects a request outright if event_time is
  more than seven days in the past, so the drain deletes expired rows rather
  than retrying them forever — an expired row does not merely fail, it fails
  every request it is sent with.
*/
create table capi_dead_letter (
  id          uuid primary key default gen_random_uuid(),
  event_name  text not null,
  /* The exact object that goes in `data: [ … ]`. */
  payload     jsonb not null,
  /* Meta's own wording from the rejection, which names the offending
     parameter — that name is the whole diagnosis. */
  last_error  text,
  attempts    integer not null default 0,
  created_at  timestamptz not null default now(),
  /* event_time + 7 days. Past this the row is unsendable, not merely unsent. */
  expires_at  timestamptz not null
);

create index capi_dead_letter_expiry_idx on capi_dead_letter (expires_at);

/* Nothing in a browser may read or write this: it holds hashed customer data
   and the shop's own conversion values. Service role only, exactly as
   shipping_quotes and price_order are locked. */
alter table capi_dead_letter enable row level security;
revoke all on table capi_dead_letter from public, anon, authenticated;
