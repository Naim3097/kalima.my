/*
  Phase 5 — customer messaging.

  Channel-agnostic by design. Email works today through Resend; WhatsApp slots
  into the same campaign/recipient tables once the client's Meta Business
  verification and per-template approval come through, which is a multi-week
  external dependency.

  PDPA is the load-bearing constraint here, not an afterthought:
  - consent is explicit and timestamped (consent_at), never assumed
  - every marketing send carries a per-subscriber unsubscribe token
  - unsubscribing is recorded, not deleted, so a later import cannot silently
    resurrect someone who opted out
*/

create table newsletter_subscribers (
  id                uuid primary key default gen_random_uuid(),
  email             text not null unique,
  name              text,
  -- Where consent was given, for the audit trail a PDPA request would need.
  source            text not null default 'footer',
  consent_at        timestamptz not null default now(),
  unsubscribed_at   timestamptz,
  -- Random, per subscriber: an unsubscribe link must not be guessable from an
  -- email address, or anyone could opt out someone else.
  unsubscribe_token text not null default encode(gen_random_bytes(24), 'hex'),
  created_at        timestamptz not null default now()
);

create index newsletter_subscribers_active_idx
  on newsletter_subscribers (email) where unsubscribed_at is null;
create unique index newsletter_subscribers_token_idx on newsletter_subscribers (unsubscribe_token);

alter table newsletter_subscribers enable row level security;

/*
  Anyone may subscribe (that is the point of a footer signup), but nobody
  unauthenticated may READ the list — an open select would hand every customer
  email to a scraper. Staff read and manage; the insert policy is write-only.
*/
create policy "anyone can subscribe" on newsletter_subscribers for insert
  with check (true);
create policy "staff manage subscribers" on newsletter_subscribers for all
  using ((select private.is_staff())) with check ((select private.is_staff()));

grant insert on newsletter_subscribers to anon, authenticated;
grant select, update, delete on newsletter_subscribers to authenticated;

create type campaign_status as enum ('draft', 'sending', 'sent', 'failed');
create type campaign_channel as enum ('email', 'whatsapp');

create table campaigns (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  channel      campaign_channel not null default 'email',
  subject      text,
  body         text not null,
  -- The audience filter, kept so a report can explain who was targeted.
  segment      jsonb not null default '{}'::jsonb,
  status       campaign_status not null default 'draft',
  scheduled_at timestamptz,
  sent_at      timestamptz,
  total_count  integer not null default 0,
  sent_count   integer not null default 0,
  failed_count integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table campaigns enable row level security;
create trigger campaigns_updated_at before update on campaigns
  for each row execute function set_updated_at();
create policy "staff manage campaigns" on campaigns for all
  using ((select private.is_staff())) with check ((select private.is_staff()));
grant select, insert, update, delete on campaigns to authenticated;

-- One row per message: the delivery report, and the proof of what was sent.
create table campaign_recipients (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns (id) on delete cascade,
  email       text not null,
  status      text not null default 'queued',   -- queued | sent | failed
  error       text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index campaign_recipients_campaign_idx on campaign_recipients (campaign_id);
create unique index campaign_recipients_unique_idx on campaign_recipients (campaign_id, email);

alter table campaign_recipients enable row level security;
create policy "staff read campaign recipients" on campaign_recipients for all
  using ((select private.is_staff())) with check ((select private.is_staff()));
grant select on campaign_recipients to authenticated;
