import {
  NEW_MEMBER,
  RETURNING_MEMBER,
  deleteFixtureOrders,
  seedMember,
  seedPaidOrder,
} from "./fixtures";

/*
  Two members, differing in exactly one fact: whether they have ever bought.
  That single difference is what the suite asserts on, so everything else about
  them — password, address, the product they buy — is deliberately identical.

  Runs before the web server is hit, so a failure here reads as a setup problem
  rather than a mysterious assertion failure three tests later.

  Credentials come from .env.local via `node --env-file` in the npm script.
*/
export default async function globalSetup() {
  // Orders first: a member cannot be deleted while their orders reference them.
  await deleteFixtureOrders();

  await seedMember(NEW_MEMBER);
  const returningId = await seedMember(RETURNING_MEMBER);
  await seedPaidOrder(returningId, RETURNING_MEMBER.email);

  console.log("[e2e] seeded fixtures: one new member, one returning member");
}
