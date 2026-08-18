import { NEW_MEMBER, RETURNING_MEMBER, deleteFixtureOrders, deleteMember } from "./fixtures";

/*
  Leaves the staging database as it was found.

  These tests place real orders against a shared project; without this, every
  run would add rows to the shop's own order list and the fixtures would show up
  in the admin screens as customers.
*/
export default async function globalTeardown() {
  const removed = await deleteFixtureOrders();
  await deleteMember(NEW_MEMBER.email);
  await deleteMember(RETURNING_MEMBER.email);

  console.log(`[e2e] cleaned up ${removed} fixture order(s) and 2 accounts`);
}
