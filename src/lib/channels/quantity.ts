/*
  What we tell a marketplace it may sell.

  Deliberately dependency-free — no `server-only`, no database client, no Next
  imports — so it can be exercised directly by a test runner. This one line of
  arithmetic decides how many units an external platform will happily sell on
  our behalf; getting it wrong is an oversell, and an oversell on Shopee is a
  cancelled order and a seller-performance penalty.

  Held back by the listing's safety buffer, because a marketplace decrements its
  own count on its own clock: between their sale and their webhook reaching us,
  they can sell stock we have already sold elsewhere. The buffer is how much of
  that race the shop chooses to absorb.

  Floored at zero — no platform accepts a negative quantity, and "sold out" is
  what we mean. Non-finite input (a null column read as NaN) collapses to zero
  rather than propagating: telling a marketplace to sell NaN units is worse than
  telling it to sell none.
*/
export function publishableQty(stockOnHand: number, safetyBuffer: number): number {
  const stock = Number.isFinite(stockOnHand) ? Math.trunc(stockOnHand) : 0;
  const buffer = Number.isFinite(safetyBuffer) ? Math.max(0, Math.trunc(safetyBuffer)) : 0;
  return Math.max(0, stock - buffer);
}
