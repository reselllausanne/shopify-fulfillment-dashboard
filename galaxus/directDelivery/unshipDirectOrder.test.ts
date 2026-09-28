import { describe, expect, it } from "vitest";

/**
 * Pure helper mirror of confirmation gate used by UI — keeps the unship
 * contract documented in tests without hitting Prisma.
 */
function shouldOfferUnship(params: {
  orderFulfilled: boolean;
  partiallyShipped: boolean;
}): boolean {
  return params.orderFulfilled || params.partiallyShipped;
}

describe("direct delivery unship affordance", () => {
  it("offers unship when fully fulfilled", () => {
    expect(shouldOfferUnship({ orderFulfilled: true, partiallyShipped: false })).toBe(true);
  });

  it("offers unship when partially shipped", () => {
    expect(shouldOfferUnship({ orderFulfilled: false, partiallyShipped: true })).toBe(true);
  });

  it("hides unship when nothing shipped", () => {
    expect(shouldOfferUnship({ orderFulfilled: false, partiallyShipped: false })).toBe(false);
  });
});
