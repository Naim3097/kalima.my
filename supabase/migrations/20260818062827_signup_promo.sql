/*
  The new-member offer: the popup that advertises it, and the money behind it.

  ONE ROW, because there is one of these at a time by definition — two popups
  fighting over the same screen is not a feature anyone wants — and a singleton
  makes "turn it off" a checkbox instead of a question about which row is live.

  TWO INDEPENDENT SWITCHES, and keeping them apart matters:

    enabled                    whether the POPUP is shown. Advertising.
    first_order_discount_sen   what a first-time member is actually taken off
                               at checkout. The offer itself. 0 = none.

  Either can be set without the other, and both readings are legitimate: run
  the discount quietly without a popup, or leave the popup up while the finance
  side is switched off. What must never happen is the popup promising money the
  checkout does not give, so the admin screen shows the two together and says
  which is which.

  NO DISCOUNT CODE. The offer is applied automatically to a member who has not
  bought before — see the first_order_discount migration for the rule, which
  lives in create_order because that is the only place that decides a price.
  A code would be a second way to get the same money, and one that anyone could
  paste into a group chat.

  The POPUP is disabled on arrival: applying this migration must not launch a
  popup on a live shop the moment it runs.

  `perks` is a jsonb array of plain strings, not markup. The modal renders them
  as a list, so an editor writes lines rather than HTML.
*/
create table signup_promo (
  id            smallint primary key default 1 check (id = 1),
  enabled       boolean not null default false,
  eyebrow       text,
  heading       text not null,
  body          text,
  perks         jsonb not null default '[]'::jsonb,
  /* What a first-time member is taken off. 0 turns the offer off entirely. */
  first_order_discount_sen integer not null default 0
    check (first_order_discount_sen >= 0),
  cta_label     text not null default 'Create my account',
  cta_href      text not null default '/signup',
  /* Long enough that it is not the first thing a visitor meets, short enough to
     be seen before they leave. Bounded so a typo cannot hide it for an hour. */
  delay_seconds integer not null default 8 check (delay_seconds between 0 and 120),
  /* How long a dismissal is respected. Nobody should meet the same popup twice
     in one afternoon because they cleared it on the homepage. */
  dismiss_days  integer not null default 14 check (dismiss_days between 1 and 365),
  updated_at    timestamptz not null default now()
);

alter table signup_promo enable row level security;
create trigger signup_promo_updated_at before update on signup_promo
  for each row execute function set_updated_at();

/* Public read: it is shown to visitors, and to signed-out ones above all. */
create policy "signup promo is public" on signup_promo for select using (true);
create policy "staff manage signup promo" on signup_promo for all
  using ((select private.is_staff())) with check ((select private.is_staff()));

grant select on signup_promo to anon, authenticated;

insert into signup_promo (id, enabled, eyebrow, heading, body, perks, first_order_discount_sen) values (
  1,
  false,
  'Kalima Club',
  'RM10 off your first order',
  'Join Kalima Club — it takes a minute, and the discount comes off your first order automatically.',
  '["RM10 off your first order — applied at checkout, no code to remember","1 point for every RM1 you spend","100 points = RM5 off a future order","Early access to new arrivals and private sales"]'::jsonb,
  1000
);
