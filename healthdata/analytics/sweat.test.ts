import { describe, expect, it } from "vitest";

import { computeSweatTest, SWEAT_FORMULA_VERSION } from "@/healthdata/analytics/sweat";

describe("computeSweatTest", () => {
  it("applies sweat_loss_v1 formula", () => {
    const result = computeSweatTest({
      weightBeforeKg: 74,
      weightAfterKg: 73,
      fluidConsumedL: 0.5,
      urineProducedL: 0.1,
      durationHours: 1.5,
    });
    // 74 - 73 + 0.5 - 0.1 = 1.4 L; / 1.5 h
    expect(result.sweatLossL).toBeCloseTo(1.4);
    expect(result.sweatRateLPerHour).toBeCloseTo(1.4 / 1.5);
    expect(result.formulaVersion).toBe(SWEAT_FORMULA_VERSION);
  });
});
