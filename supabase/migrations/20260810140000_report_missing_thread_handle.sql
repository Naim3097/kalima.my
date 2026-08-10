/*
  Tell the caller when a conversation still has no display handle.

  Instagram and Facebook do not put the sender's name in the webhook payload —
  only a scoped id. Resolving one needs a separate Graph call, and
  parseMessageWebhook is synchronous by contract, so the adapter cannot do it
  while parsing. The route has to, and it should only pay for that call when
  there is actually something to fill in.

  So this reports the state rather than making the route guess it. The webhook
  route asks the adapter for a name only when handle_missing is true, then
  writes it back. Once a thread has a handle the flag is false forever and no
  further Graph calls are made for it.

  Same shape as the customer link directly above it: retry while the field is
  null, stop once it is set, and never assume the first attempt succeeded. A
  Graph lookup can fail — rate limits, a deleted account, a user who blocked the
  Page — and the thread simply keeps showing the id until a later message
  succeeds.

  CREATE OR REPLACE with an identical signature, so the REVOKE/GRANT set from
  20260803084000 carries over untouched. Changing the argument list would drop
  those and silently re-open the function to anon.
*/
create or replace function public.record_inbound_message(
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
  v_handle          text;
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
  returning id, customer_id, external_handle
       into v_conversation_id, v_customer_id, v_handle;

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
    'customer_linked', v_customer_id is not null,
    'handle_missing', v_handle is null
  );
end;
$$;

/*
  Sets a display handle discovered after the fact.

  Separate from record_inbound_message because it runs after a network call the
  ingestion path must not wait on or fail with. Only fills a NULL, so a name the
  platform sent in a later payload is never overwritten by a stale lookup.
*/
create or replace function public.set_conversation_handle(
  p_conversation_id uuid,
  p_handle          text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversations
     set external_handle = p_handle
   where id = p_conversation_id
     and external_handle is null
     and p_handle is not null
     and length(trim(p_handle)) > 0;
$$;

/*
  service_role only, matching every other write in the inbox. The webhook route
  runs on the admin client; nothing else has any business renaming a thread.
  Revoke first — granting without revoking permits nothing new, which is how the
  Phase 7 loyalty reads ended up world-readable (20260803064500).
*/
revoke all on function public.set_conversation_handle(uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_conversation_handle(uuid, text)
  to service_role;
