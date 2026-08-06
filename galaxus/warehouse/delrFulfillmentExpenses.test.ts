import { describe, expect, it } from "vitest";
import {
  GALAXUS_DELR_PACK_CHF,
  GALAXUS_DELR_SHIP_OVER_CHF,
  GALAXUS_DELR_SHIP_UNDER_CHF,
  galaxusDelrFeeBreakdown,
} from "@/galaxus/warehouse/delrFulfillmentExpenses";

describe("galaxusDelrFeeBreakdown", () => {
  it("uses under-rate for 6 units or fewer", () => {
    expect(galaxusDelrFeeBreakdown(6)).toEqual({
      units: 6,
      packChf: GALAXUS_DELR_PACK_CHF,
      shipChf: GALAXUS_DELR_SHIP_UNDER_CHF,
      totalChf: 11,
      tier: "under",
    });
    expect(galaxusDelrFeeBreakdown(1).shipChf).toBe(6.5);
  });

  it("uses over-rate when units > 6", () => {
    expect(galaxusDelrFeeBreakdown(7)).toEqual({
      units: 7,
      packChf: GALAXUS_DELR_PACK_CHF,
      shipChf: GALAXUS_DELR_SHIP_OVER_CHF,
      totalChf: 14,
      tier: "over",
    });
  });
});
