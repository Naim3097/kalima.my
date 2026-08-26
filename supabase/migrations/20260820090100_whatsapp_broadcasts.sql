/*
  Phase 5, WhatsApp half — broadcasts sent as approved templates.

  The campaign and recipient tables were built channel-agnostic in
  20260723110330 and `campaign_channel` has carried 'whatsapp' since. What was
  missing is everything specific to how WhatsApp actually delivers a broadcast,
  which is not "an email without a subject":

  - The MESSAGE IS NOT OURS TO WRITE. Outside the 24-hour window Meta accepts
    only a pre-approved template, so a WhatsApp campaign stores a template
    reference and its variable bindings, not a body. `campaigns.body` stays as
    it is and is simply unused on this channel — a rendered preview is derived
    at send time from the template Meta holds.
  - The ADDRESS IS A PHONE, not an email.
  - The OPT-OUT IS A REPLY, not a link. Nobody clicks an unsubscribe URL in
    WhatsApp; they type "STOP". So the opt-out has to be recorded from inbound
    traffic, which is what whatsapp_opt_outs below exists for.

  CONSENT. The basis is the same signup checkbox the email list uses — "Keep me
  updated on new collections, private sales and Kalima Club rewards" — which
  sits directly beneath the phone field and is already described to the customer
  as WhatsApp updates on the account page. That plus a phone on file is the
  opt-in. It is deliberately not a second, separate flag: inventing one now
  would leave every existing consenting customer with it unset and silently
  reduce the audience to zero, which reads as a bug rather than as caution.
*/

/* ---- The campaign carries a template reference, not a body --------------- */

/*
  Nullable across the board: an email campaign has none of these, and a NOT NULL
  with a placeholder default would put a meaningless template name on every
  email row. The send path requires them for 'whatsapp' and the check constraint
  below makes that a database rule rather than a convention.
*/
alter table campaigns add column template_name     text;
alter table campaigns add column template_language text;

/*
  Positional bindings for the template's {{1}}, {{2}}, … slots, in order.

  Shape: [{"source":"first_name"}, {"source":"literal","value":"20%"}]

  Positional because Meta's own parameters are positional — the API takes an
  ordered array and matches by position, with no names anywhere in the payload.
  Keying these by name would mean inventing a mapping that has to be
  re-flattened at send time, and getting that order wrong is a mistake that
  reaches customers before it reaches a log.
*/
alter table campaigns add column template_variables jsonb not null default '[]'::jsonb;

/*
  A WhatsApp campaign without a template cannot be sent, so it cannot be saved.

  Enforced here and not only in the action because `campaigns` is written by
  more than one path, and a half-configured row is discovered at the worst
  possible moment: after the status has already been claimed as 'sending'.
*/
alter table campaigns add constraint campaigns_whatsapp_needs_template
  check (
    channel <> 'whatsapp'
    or (template_name is not null and template_language is not null)
  );

/* ---- Recipients can be addressed by phone -------------------------------- */

/*
  email loses NOT NULL and phone appears beside it. A recipient row now records
  whichever address the channel actually used, and the check keeps a row from
  recording neither — which would be a delivery report entry that names nobody.
*/
alter table campaign_recipients alter column email drop not null;
alter table campaign_recipients add column phone text;

alter table campaign_recipients add constraint campaign_recipients_has_address
  check (email is not null or phone is not null);

/*
  The phone twin of campaign_recipients_unique_idx, and the ON CONFLICT target
  the WhatsApp pipeline upserts against — the same double-send guard the email
  pipeline already has.

  A plain unique index rather than a partial one, deliberately: Postgres treats
  NULLs as distinct, so every email-campaign row (phone null) is exempt without
  a WHERE clause. That matters because PostgREST's upsert can only name columns
  for conflict inference and cannot attach the predicate a partial index would
  require to be usable.
*/
create unique index campaign_recipients_phone_idx on campaign_recipients (campaign_id, phone);

/* ---- Opt-out, recorded from inbound traffic ------------------------------ */

/*
  Keyed by PHONE, not by customer.

  Most people who message the store's WhatsApp number have no account, and the
  ones who do are matched to it only when their profile carries the same number.
  An opt-out that could only be recorded against a user row would therefore
  silently fail for exactly the people most likely to send one. The phone is
  what Meta delivers to and what we must stop delivering to, so the phone is the
  key.

  Rows are never deleted on opt-out — the same rule newsletter_subscribers
  follows. Deleting would let the next import or the next order resurrect
  someone who said no, and "we had no record" is not a defence under PDPA.
  Opting back in sets resubscribed_at rather than removing the row, so the whole
  history stays readable.
*/
create table whatsapp_opt_outs (
  id             uuid primary key default gen_random_uuid(),
  -- E.164 WITH the leading '+', matching profiles.phone. The adapter normalises
  -- wa_id (which arrives without one) before anything reaches this table; see
  -- toE164 in lib/channels/meta.ts.
  phone          text not null unique,
  -- What the customer actually typed, kept verbatim. When someone disputes an
  -- opt-out the question is always what the message said.
  reason         text,
  -- 'inbound_keyword' | 'staff' | 'import'. How we came to believe it.
  source         text not null default 'inbound_keyword',
  opted_out_at   timestamptz not null default now(),
  -- Set when they explicitly ask to hear from us again. Non-null means the
  -- opt-out is spent, and the audience resolver treats the row as absent.
  resubscribed_at timestamptz,
  created_at     timestamptz not null default now()
);

create index whatsapp_opt_outs_active_idx
  on whatsapp_opt_outs (phone) where resubscribed_at is null;

alter table whatsapp_opt_outs enable row level security;

/*
  Staff read it (the customers screen shows who has opted out); writes go
  through the service role, because the write that matters is made by the
  webhook handler, which has no user session at all.
*/
create policy "staff read whatsapp opt outs" on whatsapp_opt_outs for select
  using ((select private.is_staff()));

grant select on whatsapp_opt_outs to authenticated;

/*
  Records an opt-out from an inbound message.

  IDEMPOTENT, and deliberately does NOT refresh opted_out_at on a repeat: the
  date that matters is when they FIRST told us to stop, and a customer who types
  "STOP" three times out of frustration should not have that date walked
  forward. A repeat does clear resubscribed_at, because saying stop after
  starting again is a new, current instruction.
*/
create function public.record_whatsapp_opt_out(
  p_phone  text,
  p_reason text default null,
  p_source text default 'inbound_keyword'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_phone is null or length(trim(p_phone)) = 0 then
    return;
  end if;

  insert into public.whatsapp_opt_outs (phone, reason, source)
  values (trim(p_phone), p_reason, p_source)
  on conflict (phone) do update
    set resubscribed_at = null,
        reason          = coalesce(excluded.reason, public.whatsapp_opt_outs.reason);
end;
$$;

revoke all on function public.record_whatsapp_opt_out(text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_whatsapp_opt_out(text, text, text) to service_role;
