import { describe, expect, it } from "vitest";
import { isTheSupplierVariantId, isTheWarehouseGalaxusLine } from "./theCatalogStock";

describe("isTheWarehouseGalaxusLine", () => {
  it("detects THE warehouse lines from providerKey", () => {
    expect(
      isTheWarehouseGalaxusLine({
        supplierSku: "BQ6546-011",
        providerKey: "THE_7612345678901",
        gtin: "7612345678901",
      })
    ).toBe(true);
  });

  it("ignores STX lines", () => {
    expect(
      isTheWarehouseGalaxusLine({
        supplierSku: "U9060ASP",
        providerKey: "STX_7612345678901",
      })
    ).toBe(false);
  });
});

describe("isTheSupplierVariantId", () => {
  it("accepts the: and the_ catalog ids", () => {
    expect(isTheSupplierVariantId("the:IM4002-100-40")).toBe(true);
    expect(isTheSupplierVariantId("THE:IM4002-100-40")).toBe(true);
    expect(isTheSupplierVariantId("the_legacy")).toBe(true);
  });

  it("rejects partner/stx ids", () => {
    expect(isTheSupplierVariantId("ner:IM4002-100-40")).toBe(false);
    expect(isTheSupplierVariantId("stx_abc")).toBe(false);
    expect(isTheSupplierVariantId(null)).toBe(false);
  });
});
