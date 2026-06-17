import { describe, expect, it } from "vitest";
import { isTheWarehouseGalaxusLine } from "./theCatalogStock";

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
