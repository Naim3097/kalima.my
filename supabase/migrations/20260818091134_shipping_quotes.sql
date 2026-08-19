/*
  Server-issued shipping quotes: the browser never sends a price.

  Overseas shipping is whatever courier the customer picked, and yesterday that
  amount arrived as a PARAMETER — price_order(…, p_chosen_shipping_sen). Nothing
  sent it yet, because the address form is Malaysia-only, but the moment the
  overseas UI existed the browser would have been supplying a shipping price.
  That contradicts the rule written at the top of src/lib/commerce.ts: never
  trust amounts from the browser.

  So the server quotes, and REMEMBERS. The client is handed an opaque id and a
  service id; the price stays here. price_order looks it up itself, which keeps
  the property the last few days established — one function decides the price,
  and the quote and the charge are the same arithmetic.

  THIRTY MINUTES. Long enough for any real checkout, short enough that a courier
  rate cannot drift far underneath it. An expired quote is not an error: the
  lookup simply finds nothing, price_order reports requires_shipping_selection
  again, and the customer is re-quoted rather than charged a stale figure.

  Nothing in the browser can read this table: RLS is ON with NO POLICIES, and
  the grants are revoked explicitly. Only the service role reaches it, exactly
  as price_order itself is locked.
*/
create table shipping_quotes (
  id         uuid primary key default gen_random_uuid(),
  /* [{ service_id, service_name, courier, amount_sen, delivery_duration }] —
     amount_sen is integer sen and is the authoritative price. */
  options    jsonb not null,
  /* The address, weight and parcel value it was quoted for. Never read by the
     pricing path; kept so a disputed charge can be explained months later. */
  inputs     jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index shipping_quotes_expiry_idx on shipping_quotes (expires_at);

alter table shipping_quotes enable row level security;
revoke all on table shipping_quotes from public, anon, authenticated;

/*
  Records a set of quoted options and returns the id the checkout carries.

  Sweeps expired rows on the way through — a cheap opportunistic GC that saves
  running a scheduled job for a table that is only ever written at checkout.
*/
create or replace function public.issue_shipping_quote(
  p_options jsonb,
  p_inputs jsonb,
  p_ttl_minutes integer default 30
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  new_id uuid;
begin
  if p_options is null or jsonb_array_length(p_options) = 0 then
    raise exception 'a quote needs at least one option';
  end if;

  delete from public.shipping_quotes where expires_at < pg_catalog.now() - interval '1 day';

  insert into public.shipping_quotes (options, inputs, expires_at)
  values (
    p_options,
    coalesce(p_inputs, '{}'::jsonb),
    pg_catalog.now() + make_interval(mins => greatest(1, least(p_ttl_minutes, 120)))
  )
  returning id into new_id;

  return new_id;
end;
$function$;

revoke all on function public.issue_shipping_quote(jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function public.issue_shipping_quote(jsonb, jsonb, integer) to service_role;

/*
  What the customer chose, kept on the order so the admin books the service they
  actually paid for. bookShipment currently re-picks from live rates, which can
  hand them a different courier at a different price than the one they agreed
  to.

  The labels are copied from the FROZEN QUOTE, never from the request, so an
  order cannot be mislabelled by whoever posted the form either.
*/
alter table orders
  add column shipping_quote_id     uuid references shipping_quotes(id) on delete set null,
  add column shipping_service_id   text,
  add column shipping_service_name text,
  add column shipping_courier      text;
