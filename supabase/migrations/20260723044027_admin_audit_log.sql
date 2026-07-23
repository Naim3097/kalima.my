/*
  Phase 3 — audit log for back-office actions.

  Answers "who changed this, and when" once more than one person has staff
  access. Every admin mutation writes one row: the actor, a stable machine
  `action`, the entity it touched, and a human-readable summary rendered in the
  admin UI.

  Append-only by design: staff can read it, but nothing outside the
  service-role server actions may write, and there is no update/delete policy —
  an audit trail you can edit is not an audit trail. actor_email is denormalised
  so the record survives the user being deleted.
*/
create table admin_audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references auth.users (id) on delete set null,
  actor_email text,
  action      text not null,   -- e.g. 'order.status_changed'
  entity_type text not null,   -- 'order' | 'product' | 'discount' | ...
  entity_id   text,            -- slug, reference or uuid, whichever identifies it
  summary     text not null,   -- human-readable, shown in the UI
  meta        jsonb,
  created_at  timestamptz not null default now()
);

create index admin_audit_log_created_idx on admin_audit_log (created_at desc);
create index admin_audit_log_entity_idx on admin_audit_log (entity_type, entity_id);
create index admin_audit_log_actor_idx on admin_audit_log (actor_id);

alter table admin_audit_log enable row level security;

-- Staff may read the trail; no insert/update/delete policy exists, so only the
-- service role (which bypasses RLS) can append to it.
create policy "staff read audit log" on admin_audit_log for select
  using ((select private.is_staff()));

revoke all on admin_audit_log from anon, authenticated;
grant select on admin_audit_log to authenticated;
