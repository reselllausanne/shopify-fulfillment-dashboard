import { describe, expect, it } from "vitest";

import { aggregateOfferStatuses } from "./kicksdbImagePropagation";

describe("aggregateOfferStatuses", () => {
  it("is CORRECT only when every offer matches", () => {
    expect(aggregateOfferStatuses(["correct", "correct", "correct"])).toMatchObject({
      status: "SHOPIFY_CORRECT_GOOGLE_CORRECT",
      offerCount: 3,
      correctCount: 3,
    });
  });

  it("is PARTIAL when only some offers are correct", () => {
    expect(aggregateOfferStatuses(["correct", "mismatch", "pending"])).toMatchObject({
      status: "SHOPIFY_CORRECT_GOOGLE_PARTIAL",
      offerCount: 3,
      correctCount: 1,
      mismatchCount: 1,
      pendingCount: 1,
    });
  });

  it("never treats a single correct offer as full product validation", () => {
    const oneOfFive = aggregateOfferStatuses([
      "correct",
      "pending",
      "pending",
      "mismatch",
      "lookup_failed",
    ]);
    expect(oneOfFive.status).toBe("SHOPIFY_CORRECT_GOOGLE_PARTIAL");
    expect(oneOfFive.correctCount).toBe(1);
    expect(oneOfFive.offerCount).toBe(5);
  });

  it("returns GOOGLE_LOOKUP_FAILED when no offers", () => {
    expect(aggregateOfferStatuses([])).toMatchObject({
      status: "GOOGLE_LOOKUP_FAILED",
      offerCount: 0,
    });
  });
});
