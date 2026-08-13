import { describe, expect, it } from "vitest";

import { simulateEligibilityWaterfall } from "@/adsanalytics/explorer/core";

const baseRow = {
  shopifyProductId: "1001",
  brand: "nike",
  offerCount: 2,
  hasValidOfferId: true,
  hasValidLanguage: true,
  hasValidFeedLabel: true,
  approved: true,
  inStock: true,
  impressions30d: 0,
  conversionsAllTime: 0,
  shopifySales365: 0,
  shopifyCreatedAt: new Date(Date.now() - 40 * 86400_000).toISOString(),
  sourceCampaignCount: 1,
  sourceCampaignNames: ["Nike PM Feed Only"],
  inActiveBatch: false,
  inCooldown: false,
};

describe("eligibility waterfall regressions", () => {
  it("keeps inventory model without ads metrics rows (interpreted zero)", () => {
    const rows = [{ ...baseRow, impressions30d: 0, conversionsAllTime: 0 }];
    const out = simulateEligibilityWaterfall(rows, true);
    expect(out).toHaveLength(1);
  });

  it("does not drop model when shopify sales are absent", () => {
    const rows = [{ ...baseRow, shopifySales365: 0 }];
    const out = simulateEligibilityWaterfall(rows, true);
    expect(out).toHaveLength(1);
  });

  it("treats null-like metrics as zero in gating step", () => {
    const rows = [
      {
        ...baseRow,
        impressions30d: Number((undefined as unknown as number) ?? 0),
        conversionsAllTime: Number((undefined as unknown as number) ?? 0),
      },
    ];
    const out = simulateEligibilityWaterfall(rows, true);
    expect(out).toHaveLength(1);
  });

  it("keeps one model even with two language offers aggregated", () => {
    const rows = [{ ...baseRow, offerCount: 2 }];
    const out = simulateEligibilityWaterfall(rows, true);
    expect(out.map((r) => r.shopifyProductId)).toEqual(["1001"]);
  });
});

