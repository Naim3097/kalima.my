/*
  WhatsApp message templates — the only way to reach a customer outside the
  24-hour window.

  WHY A TABLE AND NOT A CONSTANT. Meta owns the approval, not us. A template
  Kalima wrote last week can be APPROVED today, PAUSED tomorrow for poor
  quality, and DISABLED the week after — none of which involves a deploy on our
  side. Hard-coding a template name would mean the admin cheerfully offers a
  template Meta stopped accepting, and every send fails at the API with an
  error staff cannot act on.

  So this is a CACHE of Meta's registry, refreshed by
  lib/channels/whatsapp-templates.ts. Meta remains the source of truth for
  everything in it; nothing here is authored locally. That is also why there is
  no staff write policy: editing a row would change what the admin offers
  without changing what Meta accepts, which is a lie with a send failure
  attached.

  STATUS IS TEXT, NOT AN ENUM. Meta's vocabulary is Meta's to extend — they
  added PENDING_DELETION after this integration was designed, and an enum would
  turn that into a failed sync rather than an unfamiliar string in a column. The
  only value the send path treats as sendable is 'APPROVED', checked explicitly,
  so an unknown status fails closed by simply not matching.
*/

create table whatsapp_templates (
  id               uuid primary key default gen_random_uuid(),
  -- Meta's own template id, kept so a template deleted and recreated under the
  -- same name is distinguishable from one that was merely re-approved.
  external_id      text,
  name             text not null,
  -- Meta keys templates on (name, language) and a name can carry several
  -- translations, so the language is half the identity — never a display field.
  language         text not null,
  -- MARKETING | UTILITY | AUTHENTICATION. Drives what Meta charges and what
  -- consent is required, so it is shown to staff rather than hidden.
  category         text,
  status           text not null default 'PENDING',

  -- Meta's components array, verbatim. Stored whole because the send call has
  -- to match the template's real structure, and a shape we flattened is a shape
  -- we would have to guess our way back out of.
  components       jsonb not null default '[]'::jsonb,

  -- Derived from `components` at sync time, for cheap reads on the admin
  -- screens: the composer needs the body text and the number of {{n}} slots on
  -- every keystroke, and parsing the blob per render is wasted work.
  body_text        text,
  header_format    text,
  header_text      text,
  body_variables   integer not null default 0 check (body_variables >= 0),
  header_variables integer not null default 0 check (header_variables >= 0),
  buttons          jsonb,

  -- Why Meta refused it, and how the number is scoring. Both come from Meta and
  -- are the first thing anyone asks when a template stops working.
  rejected_reason  text,
  quality_score    text,

  -- Last time this row was confirmed against Meta. A stale sync is the likeliest
  -- reason the admin and the API disagree, so the age is visible rather than
  -- inferred.
  synced_at        timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

/* (name, language) is Meta's key, so it is ours — this is what makes the sync
   an upsert rather than a delete-and-reinsert that would churn ids. */
create unique index whatsapp_templates_name_idx on whatsapp_templates (name, language);
create index whatsapp_templates_sendable_idx
  on whatsapp_templates (name) where status = 'APPROVED';

create trigger whatsapp_templates_updated_at before update on whatsapp_templates
  for each row execute function set_updated_at();

/*
  Staff read; nobody writes but the service role.

  Read rather than sealed entirely (the treatment channel_connections gets)
  because there is no secret here — a template body is text Meta already
  approved for sending to the public. Write-locked because of the note above:
  the only honest way to change this table is to change it at Meta and sync.
*/
alter table whatsapp_templates enable row level security;

create policy "staff read whatsapp templates" on whatsapp_templates for select
  using ((select private.is_staff()));

grant select on whatsapp_templates to authenticated;

/*
  Which template a given outbound message was sent as.

  Null for ordinary free-text replies, which is the overwhelming majority. It
  matters for the ones where it is set: a template send is a different
  compliance object from a reply — it is billed by Meta, it is governed by
  per-category consent rules, and when a customer complains about an unwanted
  message the question is always "which template, sent by whom, when". The
  rendered text is already in `body`; this records what produced it.
*/
alter table messages add column template_name text;

comment on column messages.template_name is
  'WhatsApp template used for this outbound message; null for free-text replies.';

/*
  record_outbound_message, now carrying the template name.

  DROPPED AND RECREATED rather than given a defaulted sixth parameter. Adding
  `p_template_name text default null` to the existing signature would create an
  OVERLOAD, not a replacement — and every existing five-argument call would then
  match both, which Postgres rejects at call time with "function
  public.record_outbound_message is not unique". A send path that fails only
  once the new migration lands is precisely the shape of bug worth spending four
  extra lines to avoid.

  The default keeps every current caller (free-text replies, internal notes)
  working unchanged; only the template path passes the sixth argument.

  Grants are re-issued because they belong to the signature, not the name: the
  drop takes the old revoke and grant with it, and a function nobody granted is
  a function the service role cannot call.
*/
drop function public.record_outbound_message(uuid, message_direction, text, uuid, message_delivery);

create function public.record_outbound_message(
  p_conversation_id uuid,
  p_direction       message_direction,
  p_body            text,
  p_sent_by         uuid,
  p_delivery        message_delivery default 'pending',
  p_template_name   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_message_id uuid; v_now timestamptz := pg_catalog.now();
begin
  if p_direction = 'inbound' then
    raise exception 'use record_inbound_message for inbound messages';
  end if;
  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'message body is required';
  end if;
  /*
    A note is internal and never reaches a platform, so it can never be a
    template. Rejecting the combination here rather than trusting the caller
    keeps the compliance record honest: every row with a template_name is a row
    Meta was actually asked to deliver.
  */
  if p_direction = 'note' and p_template_name is not null then
    raise exception 'an internal note cannot be a template send';
  end if;

  insert into public.messages (
    conversation_id, direction, body, sent_by, sent_at, delivery, template_name
  )
  values (p_conversation_id, p_direction, p_body, p_sent_by, v_now,
          case when p_direction = 'note' then 'delivered'::public.message_delivery else p_delivery end,
          p_template_name)
  returning id into v_message_id;

  -- A note is not a message to the customer, so it does not advance the thread
  -- timestamp used for sorting the "needs a reply" list.
  if p_direction = 'outbound' then
    update public.conversations set last_message_at = v_now where id = p_conversation_id;
  end if;

  return jsonb_build_object('message_id', v_message_id);
end;
$$;

revoke all on function public.record_outbound_message(uuid, message_direction, text, uuid, message_delivery, text)
  from public, anon, authenticated;
grant execute on function public.record_outbound_message(uuid, message_direction, text, uuid, message_delivery, text)
  to service_role;
