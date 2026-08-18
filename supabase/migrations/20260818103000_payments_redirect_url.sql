/*
  Remember where a payment attempt sent the shopper.

  WHY A COLUMN AND NOT A RECOMPUTATION. "Try payment again" on the success page
  used to walk the shopper back through the picker, which called createCheckout
  and minted a SECOND hosted bill while the first was still payable. Two live
  bills on one order means two ways to be charged for it — and the settlement
  side is idempotent, so the second payment lands on an order already marked
  paid and simply becomes money we have to give back by hand.

  The gateway's hosted URL is the only thing needed to send someone back to the
  attempt they already have, and neither gateway will hand it out again after
  creation: LeanX mints a fresh bill_no on every call, and Atome's create is
  idempotent on referenceId but we deliberately vary that per attempt. So it is
  stored at creation, and startPayment resumes from it rather than re-minting.

  Nullable, because every row written before this exists without one — those
  simply cannot be resumed and fall through to the old behaviour.
*/
alter table payments add column if not exists redirect_url text;

comment on column payments.redirect_url is
  'Hosted payment page for this attempt. Used to resume a live attempt instead of creating a second bill.';
