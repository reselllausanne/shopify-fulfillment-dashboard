import { describe, expect, it } from "vitest";
import { compactCatalogSkuQuery, catalogSkuHitIndexes } from "./catalogSkuLookup";

describe("compactCatalogSkuQuery", () => {
  it("strips spaces for MW-style Reichelt SKUs", () => {
    expect(compactCatalogSkuQuery("MW 3A03GS")).toBe("MW3A03GS");
    expect(compactCatalogSkuQuery("  mw  3a03gs ")).toBe("mw3a03gs");
  });

  it("leaves compact SKUs unchanged", () => {
    expect(compactCatalogSkuQuery("MW3A03GS")).toBe("MW3A03GS");
  });
});

describe("catalogSkuHitIndexes", () => {
  it("dedupes gtins and maps style SKU", () => {
    const idx = catalogSkuHitIndexes([
      { gtin: "4040849547935", providerKey: "REI_4040849547935", supplierSku: "MW 3A03GS" },
      { gtin: "4040849547935", providerKey: "REI_4040849547935", supplierSku: "MW 3A03GS" },
      { gtin: null, providerKey: "REI_OTHER", supplierSku: "AB 1" },
    ]);
    expect(idx.gtins).toEqual(["4040849547935"]);
    expect(idx.providerKeys).toEqual(["REI_4040849547935", "REI_OTHER"]);
    expect(idx.skuByGtin.get("4040849547935")).toBe("MW 3A03GS");
  });
});
