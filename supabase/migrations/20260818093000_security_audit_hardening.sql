/*
  Three findings from the 2026-08-18 security audit. None of them was a live
  breach; all three were a control resting on something other than itself.

  ------------------------------------------------------------------------
  1. newsletter_subscribers was writable by anon, straight over PostgREST
  ------------------------------------------------------------------------
  `anyone can subscribe` was `with check (true)` for the public role, and anon
  holds the default column grants — so anyone with the publishable key could
  insert rows with an email, a source and a consent_at of their choosing,
  bypassing the server action entirely. Nothing leaked (there is no anon SELECT
  policy), but the consent trail is exactly the thing a PDPA request asks us to
  stand behind, and it was forgeable.

  The policy turns out to be vestigial: every write in the app goes through
  createAdminClient in a server action — subscribeToNewsletter, the unsubscribe
  page, the campaign sender — and the service role does not consult RLS. So this
  is a straight removal, not a substitution. Subscription still works; it just
  has to come through our code, where the address is validated, an opt-out can
  no longer be overturned, and there is now a rate limit.

  ------------------------------------------------------------------------
  2. Write grants on the EasyParcel token columns outlived their SELECT
  ------------------------------------------------------------------------
  SELECT on easyparcel_access_token / _refresh_token / _token_expires was
  correctly revoked from anon and authenticated. INSERT and UPDATE were not, so
  the courier's OAuth tokens were writable-in-principle by the browser key, with
  only the staff-gated RLS policy in the way. That is one control where the
  design plainly intended two, and the inconsistency is the bug — a future
  policy edit should not be able to expose credentials by accident.

  ------------------------------------------------------------------------
  3. Order references were sequential, so they enumerate
  ------------------------------------------------------------------------
  `'KLM-' || nextval(...)` gives KLM-10250, KLM-10251, … and
  get_order_by_reference authorises on reference + email alone. Anyone who knows
  a customer's email address — a low bar — could walk the sequence to find their
  orders and read status, line items, totals and the recipient's name.

  The sequence STAYS, because finance reads it: KLM-10287 is how an order is
  discussed, and it sorts. A short random suffix is appended, so the reference
  is still human-sized and no longer guessable. Existing references are left
  exactly as they are: they are printed on invoices and quoted in Atome's
  settlement report, and rewriting them would break more than it protects.
*/

drop policy if exists "anyone can subscribe" on newsletter_subscribers;

revoke insert, update on newsletter_subscribers from anon;

/*
  TABLE-LEVEL, NOT COLUMN-LEVEL — and that distinction is the whole reason this
  was still open. The SELECT hardening that came before worked because it
  revoked the table privilege and re-granted a column list. A column-level
  REVOKE against a table-wide grant is silently a no-op in Postgres (the
  table-level privilege still implies every column), which is exactly what the
  first version of this migration did and why the grants survived it.

  Nothing writes store_settings with a user-scoped client: every caller —
  admin/actions.ts and lib/shipping/config.ts alike — holds the service role,
  which does not consult these grants at all. So this is a straight removal, and
  anon keeps the SELECT column list the storefront reads.
*/
revoke insert, update on store_settings from anon, authenticated;

/*
  gen_random_bytes lives in the `extensions` schema (pgcrypto), which a column
  default evaluates under the writer's search_path — and create_order runs with
  search_path = '', so it must be schema-qualified here or every insert fails.
  Same trap 20260722060902 documents for uuid_generate_v4().

  Six hex characters: 16.7 million per sequence number, appended rather than
  replacing it so KLM-10287-A3F9C1 still reads as order 10287.
*/
alter table orders
  alter column reference
  set default 'KLM-' || nextval('order_reference_seq') || '-' ||
              upper(encode(extensions.gen_random_bytes(3), 'hex'));
