/*
  Transactional WhatsApp — a template sent automatically when an order event
  happens: paid, shipped, delivered.

  WHICH TEMPLATE IS A SETTING, NOT A CONSTANT, for the reason whatsapp_templates
  gives: Meta approves, pauses and disables templates without a deploy on our
  side, so the event → template mapping is chosen by staff from what Meta has
  actually approved, and switched off independently of the code that fires it.
  Each event has a fixed, documented list of values (first name, order
  reference, …) supplied in order; the template chosen for it must take no more
  values than that list offers.

  ONE ROW PER EVENT. The three rows are seeded disabled so the feature exists
  in the admin before anyone has written a template, and nothing sends until a
  person picks one and ticks the box.
*/
create table whatsapp_automations (
  event             text primary key
                    check (event in ('order_paid', 'order_shipped', 'order_delivered')),
  template_name     text,
  template_language text,
  enabled           boolean not null default false,
  updated_at        timestamptz not null default now(),
  /* Enabled without a template is an automation that can only fail. */
  constraint whatsapp_automations_enabled_needs_template
    check (not enabled or (template_name is not null and template_language is not null))
);
create trigger whatsapp_automations_updated_at before update on whatsapp_automations
  for each row execute function set_updated_at();

insert into whatsapp_automations (event) values ('order_paid'), ('order_shipped'), ('order_delivered');

alter table whatsapp_automations enable row level security;
create policy "staff read whatsapp automations" on whatsapp_automations for select
  using ((select private.is_staff()));
grant select on whatsapp_automations to authenticated;

/*
  THE CLAIM. Every event can reach the sender more than once — a payment
  webhook redelivered, a parcel booked and then its status pushed, a shipment
  edited by hand — and a customer must get each message ONCE. Inserting here
  before sending is the guard: the second caller hits the primary key and
  stops. Kept after the send too, as the record of what was sent for which
  order, with the outcome.
*/
create table whatsapp_automation_sends (
  event         text not null,
  order_id      uuid not null references orders (id) on delete cascade,
  phone         text,
  template_name text,
  status        text not null default 'pending'
                check (status in ('pending', 'sent', 'failed', 'skipped')),
  detail        text,
  message_id    uuid references messages (id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (event, order_id)
);
create index whatsapp_automation_sends_order_idx on whatsapp_automation_sends (order_id);

alter table whatsapp_automation_sends enable row level security;
create policy "staff read whatsapp automation sends" on whatsapp_automation_sends for select
  using ((select private.is_staff()));
grant select on whatsapp_automation_sends to authenticated;
