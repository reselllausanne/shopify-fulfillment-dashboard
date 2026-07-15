import { describe, expect, it } from "vitest";
import { isStxListingEligibleAsks, publishStxStockFromAsks } from "./stockPublish";

describe("publishStxStockFromAsks", () => {
  it("lists a single ask", () => {
    expect(publishStxStockFromAsks(1)).toBe(1);
    expect(isStxListingEligibleAsks(1)).toBe(true);
  });

  it("zeros out when no asks", () => {
    expect(publishStxStockFromAsks(0)).toBe(0);
    expect(isStxListingEligibleAsks(0)).toBe(false);
  });

  it("keeps conservative caps for deeper books", () => {
    expect(publishStxStockFromAsks(3)).toBe(2);
    expect(publishStxStockFromAsks(8)).toBe(5);
    expect(publishStxStockFromAsks(25)).toBe(12);
  });
});
