import { describe, expect, it } from "vitest";
import {
  buildLocalStockMatchReasons,
  isLocalStockMatchRow,
  mergeReservedPhysicalStockOntoLines,
  parseLocalStockLocationFromMatch,
  resolveGalaxusLocalStockCostChf,
  shouldAutoLocalStockMatch,
} from "@/galaxus/orders/localStockMatch";

describe("resolveGalaxusLocalStockCostChf", () => {
  it("returns Essentials hoodie hard COGS 42", () => {
    const r = resolveGalaxusLocalStockCostChf({
      productName: "Fear Of God Essentials Fleece Hoodie (FW24) Black (S)",
      shopifySku: "192HO246250F-S",
    });
    expect(r?.costChf).toBe(42);
  });

  it("returns Essentials tee hard COGS 26", () => {
    const r = resolveGalaxusLocalStockCostChf({
      productName: "Fear Of God Essentials Tee Stretch Limo",
      shopifySku: "125HO244368F-M",
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
    expect(d.costChf).toBe(42);
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

describe("localStockMatch location helpers", () => {
  it("encodes and parses sale location", () => {
    const reasons = buildLocalStockMatchReasons({
      reason: "LOCAL_PHYSICAL_STOCK_AFTER_MARKETPLACE_SALE",
      locationName: "THE LAB CONCEPT STORE",
      locationId: "gid://shopify/Location/111267250562",
    });
    const loc = parseLocalStockLocationFromMatch({ matchReasons: reasons });
    expect(loc).toEqual({
      locationName: "THE LAB CONCEPT STORE",
      locationId: "gid://shopify/Location/111267250562",
    });
  });

  it("parses legacy location:Name string reasons", () => {
    const loc = parseLocalStockLocationFromMatch({
      matchReasons: JSON.stringify(["LOCAL_PHYSICAL_STOCK", "location:Warehouse Bussigny"]),
    });
    expect(loc).toEqual({ locationName: "Warehouse Bussigny", locationId: null });
  });

  it("detects LOCAL_STOCK match rows", () => {
    expect(
      isLocalStockMatchRow({
        matchType: "LOCAL_STOCK",
        stockxStatus: "LOCAL_STOCK",
        stockxOrderNumber: "LOCAL-STOCK-1-1",
      })
    ).toBe(true);
    expect(
      isLocalStockMatchRow({
        matchType: "AUTO",
        stockxStatus: "SHIPPED",
        stockxOrderNumber: "01-abc",
      })
    ).toBe(false);
  });

  it("fills physicalStock from LOCAL_STOCK when live qty is 0", () => {
    const merged = mergeReservedPhysicalStockOntoLines(
      [
        {
          id: "line-1",
          gtin: "197298832618",
          physicalStock: null,
        },
      ],
      [
        {
          galaxusOrderLineId: "line-1",
          matchType: "LOCAL_STOCK",
          stockxStatus: "LOCAL_STOCK",
          stockxOrderNumber: "LOCAL-STOCK-200248007-1",
          matchReasons: buildLocalStockMatchReasons({
            reason: "LOCAL_PHYSICAL_STOCK_AFTER_MARKETPLACE_SALE",
            locationName: "THE LAB CONCEPT STORE",
            locationId: "gid://shopify/Location/111267250562",
          }),
        },
      ]
    );
    expect(merged[0]?.physicalStock).toMatchObject({
      qty: 1,
      locationName: "THE LAB CONCEPT STORE",
      reservedFromSale: true,
    });
  });
});
