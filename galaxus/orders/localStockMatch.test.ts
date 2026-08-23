import { describe, expect, it } from "vitest";
import {
  resolveGalaxusLocalStockCostChf,
  shouldAutoLocalStockMatch,
} from "@/galaxus/orders/localStockMatch";

describe("resolveGalaxusLocalStockCostChf", () => {
  it("returns Essentials hoodie hard COGS 26", () => {
    const r = resolveGalaxusLocalStockCostChf({
      productName: "Fear Of God Essentials Fleece Hoodie (FW24) Black (S)",
      shopifySku: "192HO246250F-S",
    });
    expect(r?.costChf).toBe(26);
  });

  it("returns Bape tee hard COGS 35", () => {
    const r = resolveGalaxusLocalStockCostChf({
      productName: "BAPE Color Camo Big Ape Head Tee White",
    });
    expect(r?.costChf).toBe(35);
  });

  it("returns Audemars x Travis tee hard COGS 40", () => {
    const r = resolveGalaxusLocalStockCostChf({
      productName: "Travis Scott x Audemars Piguet Vintage Tee Black",
    });
    expect(r?.costChf).toBe(40);
  });

  it("returns Supreme boxers hard COGS 20", () => {
    const r = resolveGalaxusLocalStockCostChf({
      productName: "Supreme Hanes Boxer Briefs (4 Pack) Black",
    });
    expect(r?.costChf).toBe(20);
  });
});

describe("shouldAutoLocalStockMatch", () => {
  it("auto-links Essentials hoodie even when physical mirror qty is 0", () => {
    const d = shouldAutoLocalStockMatch({
      productName: "Fear Of God Essentials Fleece Hoodie (FW24) Black (S)",
      shopifySku: "192HO246250F-S",
      physicalStock: { qty: 0 },
    });
    expect(d.ok).toBe(true);
    expect(d.costChf).toBe(26);
  });

  it("auto-links generic STX line when physical stock > 0 at cost 0", () => {
    const d = shouldAutoLocalStockMatch({
      productName: "Random STX Shoe",
      physicalStock: { qty: 2, locationName: "Warehouse Bussigny" },
    });
    expect(d.ok).toBe(true);
    expect(d.costChf).toBe(0);
    expect(d.reason).toBe("LOCAL_PHYSICAL_STOCK");
  });

  it("skips unknown STX line with no physical stock", () => {
    const d = shouldAutoLocalStockMatch({
      productName: "Random STX Shoe",
      physicalStock: { qty: 0 },
    });
    expect(d.ok).toBe(false);
  });
});
