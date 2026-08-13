import { describe, expect, it } from "vitest";

import { selectBatchModelsStratified } from "@/adsanalytics/explorer/core";

describe("selectBatchModelsStratified", () => {
  it("is deterministic for same seed", () => {
    const mapped = Array.from({ length: 120 }, (_, i) => ({
      shopifyProductId: String(1000 + i),
      sourceCampaignId: i < 60 ? "c1" : "c2",
      sourceCampaignName: i < 60 ? "Campaign A" : "Campaign B",
      brand: i % 3 === 0 ? "nike" : i % 3 === 1 ? "adidas" : "jordan",
      offerCount: 3,
    }));
    const a = selectBatchModelsStratified(mapped, 50, "seed-1");
    const b = selectBatchModelsStratified(mapped, 50, "seed-1");
    expect(a.selected.map((x) => x.shopifyProductId)).toEqual(
      b.selected.map((x) => x.shopifyProductId)
    );
  });

  it("keeps model-level uniqueness even with multi-language offers", () => {
    const mapped = [
      {
        shopifyProductId: "2001",
        sourceCampaignId: "c1",
        sourceCampaignName: "Campaign A",
        brand: "nike",
        offerCount: 6, // en/de/fr x variants
      },
      {
        shopifyProductId: "2002",
        sourceCampaignId: "c1",
        sourceCampaignName: "Campaign A",
        brand: "nike",
        offerCount: 3,
      },
    ];
    const res = selectBatchModelsStratified(mapped, 1, "seed-2");
    expect(res.selected).toHaveLength(1);
    expect(new Set(res.selected.map((s) => s.shopifyProductId)).size).toBe(1);
  });
});

