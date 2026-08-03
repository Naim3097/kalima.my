/*
  Phase 9 — unified inbox.

  Every incoming message from every channel lands in one place, linked to the
  sender's customer record, and is replied to without leaving the admin. The
  client's stated headline priority is unification and REPLY, not broadcast.

  As with Phase 8, this is everything that does not depend on a vendor's API
  contract. No channel is connected yet — Meta Business verification and App
  Review, plus the Shopee and TikTok apps, are all outstanding — so the adapters
  stay stubs and the ingestion route fails closed until one is wired.
*/

create type conversation_status as enum ('open', 'snoozed', 'closed');

/*
  'note' is a third kind alongside inbound and outbound, not a flag on outbound.

  Internal notes belong in the thread — the context staff need is the context
  they are reading — but they must NEVER be sent. Making it a direction means
  the send path filters on direction = 'outbound' and a note cannot reach a
  customer through any code path, rather than depending on every future caller
  remembering to check an is_internal boolean.
*/
create type message_direction as enum ('inbound', 'outbound', 'note');

create type message_delivery as enum ('pending', 'sent', 'delivered', 'read', 'failed');

create table conversations (
  id                 uuid primary key default gen_random_uuid(),
  channel            sales_channel not null,
  -- The platform's own thread id. The idempotency anchor for the conversation.
  external_thread_id text not null,
  -- The platform's id and display handle for the person we are talking to.
  external_user_id   text,
  external_handle    text,
  -- Resolved customer, when we can match one. Nullable and stays nullable:
  -- plenty of enquiries come from people who have never bought anything, and
  -- refusing to hold their message until they do would be absurd.
  customer_id        uuid references auth.users (id) on delete set null,
  /*
    Drives the reply window. Every channel closes free-text replies some hours
    after the customer's LAST INBOUND message — 24h on Meta, 48h on TikTok
    Business — so this column, not last_message_at, is the one that matters.
    Our own outbound reply does not reopen a window.
  */
  last_inbound_at    timestamptz,
  last_message_at    timestamptz,
  unread_count       integer not null default 0 check (unread_count >= 0),
  assigned_to        uuid references auth.users (id) on delete set null,
  status             conversation_status not null default 'open',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index conversations_external_idx
  on conversations (channel, external_thread_id);
create index conversations_recent_idx on conversations (last_message_at desc nulls last);
create index conversations_customer_idx on conversations (customer_id) where customer_id is not null;

create trigger conversations_updated_at before update on conversations
  for each row execute function set_updated_at();

create table messages (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references conversations (id) on delete cascade,
  direction           message_direction not null,
  body                text,
  -- [{ storage_path, mime, name }] — media mirrored into Storage, because a
  -- platform's CDN url expires and an expired attachment is a lost record.
  attachments         jsonb,
  -- The platform's message id. UNIQUE, and the reason a redelivered webhook
  -- cannot double-post. Null for notes and for outbound not yet acknowledged.
  external_message_id text,
  -- Staff author, for outbound and notes.
  sent_by             uuid references auth.users (id) on delete set null,
  delivery            message_delivery not null default 'delivered',
  delivery_error      text,
  sent_at             timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

create unique index messages_external_idx
  on messages (external_message_id) where external_message_id is not null;
create index messages_thread_idx on messages (conversation_id, sent_at);

create table canned_replies (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger canned_replies_updated_at before update on canned_replies
  for each row execute function set_updated_at();

/*
  RLS: staff only, on everything.

  These tables hold customer PII and the contents of private conversations.
  There is no customer-facing view of an inbox thread anywhere in the product,
  so no policy grants one — a customer reading their own thread is a feature
  that does not exist, and inventing a policy for it now would be an untested
  read path over sensitive data.

  Writes go exclusively through the service-role functions below, so no write
  policy exists either.
*/
alter table conversations  enable row level security;
alter table messages       enable row level security;
alter table canned_replies enable row level security;

create policy "staff read conversations" on conversations for select
  using ((select private.is_staff()));
create policy "staff read messages" on messages for select
  using ((select private.is_staff()));
create policy "staff manage canned replies" on canned_replies for all
  using ((select private.is_staff())) with check ((select private.is_staff()));

grant select on conversations, messages to authenticated;
grant select on canned_replies to authenticated;

/*
  Records an inbound message and the conversation it belongs to.

  IDEMPOTENT on external_message_id: platforms redeliver, and a duplicate here
  would show the customer's question twice and inflate the unread count.

  CUSTOMER LINKING is attempted once, on first contact, matching a supplied
  phone (E.164, which is how profiles stores it) or email. It is deliberately
  not retried on every message: someone linked by hand should stay linked, and
  re-deriving the link per message would overwrite that correction silently.

  last_inbound_at is stamped here and ONLY here. Our outbound replies must not
  touch it, or the reply window would extend itself every time we answered —
  which is exactly backwards, and would let staff type into a window the
  platform has already closed.
*/
create function public.record_inbound_message(
  p_channel             sales_channel,
  p_external_thread_id  text,
  p_external_message_id text,
  p_external_user_id    text,
  p_external_handle     text,
  p_body                text,
  p_attachments         jsonb,
  p_sent_at             timestamptz,
  p_contact_phone       text default null,
  p_contact_email       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid;
  v_message_id      uuid;
  v_customer_id     uuid;
  v_sent_at         timestamptz := coalesce(p_sent_at, pg_catalog.now());
begin
  if p_external_thread_id is null or length(trim(p_external_thread_id)) = 0 then
    raise exception 'external thread id is required';
  end if;

  -- Duplicate check first: a redelivery must not even touch the conversation.
  if p_external_message_id is not null then
    select id into v_message_id from public.messages
     where external_message_id = p_external_message_id;
    if found then
      return jsonb_build_object('recorded', false, 'reason', 'already recorded',
                                'message_id', v_message_id);
    end if;
  end if;

  insert into public.conversations (channel, external_thread_id, external_user_id, external_handle)
  values (p_channel, p_external_thread_id, p_external_user_id, p_external_handle)
  on conflict (channel, external_thread_id) do update
    set external_handle = coalesce(excluded.external_handle, public.conversations.external_handle),
        external_user_id = coalesce(excluded.external_user_id, public.conversations.external_user_id)
  returning id, customer_id into v_conversation_id, v_customer_id;

  -- First contact only — see the note above.
  if v_customer_id is null then
    if p_contact_phone is not null and length(trim(p_contact_phone)) > 0 then
      select p.id into v_customer_id from public.profiles p
       where p.phone = trim(p_contact_phone) limit 1;
    end if;
    if v_customer_id is null and p_contact_email is not null and length(trim(p_contact_email)) > 0 then
      select u.id into v_customer_id from auth.users u
       where lower(u.email) = lower(trim(p_contact_email)) limit 1;
    end if;
    if v_customer_id is not null then
      update public.conversations set customer_id = v_customer_id where id = v_conversation_id;
    end if;
  end if;

  insert into public.messages
    (conversation_id, direction, body, attachments, external_message_id, sent_at, delivery)
  values
    (v_conversation_id, 'inbound', p_body, p_attachments, p_external_message_id, v_sent_at, 'delivered')
  returning id into v_message_id;

  update public.conversations
     set last_inbound_at = greatest(coalesce(last_inbound_at, v_sent_at), v_sent_at),
         last_message_at = greatest(coalesce(last_message_at, v_sent_at), v_sent_at),
         unread_count = unread_count + 1,
         -- An inbound message reopens a closed thread: the customer is still
         -- talking, whatever we decided earlier.
         status = case when status = 'closed' then 'open' else status end
   where id = v_conversation_id;

  return jsonb_build_object(
    'recorded', true,
    'conversation_id', v_conversation_id,
    'message_id', v_message_id,
    'customer_linked', v_customer_id is not null
  );
end;
$$;

/*
  Records an outbound reply or an internal note.

  Notes are stored and never sent — the caller passes 'note' and no send is
  attempted. Outbound rows start 'pending' and are moved to 'sent' by the
  adapter, so a message that failed upstream is visibly failed rather than
  silently absent.

  Does NOT touch last_inbound_at. See record_inbound_message.
*/
create function public.record_outbound_message(
  p_conversation_id uuid,
  p_direction       message_direction,
  p_body            text,
  p_sent_by         uuid,
  p_delivery        message_delivery default 'pending'
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

  insert into public.messages (conversation_id, direction, body, sent_by, sent_at, delivery)
  values (p_conversation_id, p_direction, p_body, p_sent_by, v_now,
          case when p_direction = 'note' then 'delivered'::public.message_delivery else p_delivery end)
  returning id into v_message_id;

  -- A note is not a message to the customer, so it does not advance the thread
  -- timestamp used for sorting the "needs a reply" list.
  if p_direction = 'outbound' then
    update public.conversations set last_message_at = v_now where id = p_conversation_id;
  end if;

  return jsonb_build_object('message_id', v_message_id);
end;
$$;

create function public.mark_conversation_read(p_conversation_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversations set unread_count = 0 where id = p_conversation_id;
$$;

/*
  All three of public, anon and authenticated — `public` covers Postgres's
  built-in EXECUTE grant, the other two cover Supabase's default privileges.
  Granting without revoking permits nothing new; that is how the Phase 7 loyalty
  reads ended up world-readable (20260803064500).
*/
revoke all on function public.record_inbound_message(sales_channel, text, text, text, text, text, jsonb, timestamptz, text, text)
  from public, anon, authenticated;
revoke all on function public.record_outbound_message(uuid, message_direction, text, uuid, message_delivery)
  from public, anon, authenticated;
revoke all on function public.mark_conversation_read(uuid) from public, anon, authenticated;

grant execute on function public.record_inbound_message(sales_channel, text, text, text, text, text, jsonb, timestamptz, text, text)
  to service_role;
grant execute on function public.record_outbound_message(uuid, message_direction, text, uuid, message_delivery)
  to service_role;
grant execute on function public.mark_conversation_read(uuid) to service_role;

/*
  A few starting canned replies, in the brand's voice and bilingual where the
  question usually arrives in Malay. Editable in the admin.
*/
insert into canned_replies (title, body, sort_order) values
  ('Order status',
   'Hi! Thanks for waiting 🤍 Let me check that order for you — I''ll come back with the tracking details shortly.', 0),
  ('Restock enquiry',
   'Thank you for asking! That piece is currently out of stock. We restock regularly — follow us or join Kalima Club and you''ll hear first.', 1),
  ('Shipping time',
   'Orders are packed within 1–2 working days, and delivery is usually 2–4 working days for West Malaysia and 3–7 for East Malaysia.', 2),
  ('Returns',
   'Of course — we accept returns within 14 days of delivery, as long as the item is unworn with tags on. Would you like me to start that for you?', 3),
  ('Size help',
   'Happy to help with sizing! Could you share your usual size and height? I can then recommend the best fit for this piece.', 4);
