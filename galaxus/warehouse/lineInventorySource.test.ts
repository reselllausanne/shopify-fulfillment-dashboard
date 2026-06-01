import { describe, expect, it } from "vitest";
import {
  galaxusLineWarehouseStockHint,
  resolveGalaxusLineOfferSupplierSku,
} from "./lineInventorySource";

describe("galaxusLineWarehouseStockHint", () => {
  it("detects NER from providerKey when supplierSku is catalog style id", () => {
    expect(
      galaxusLineWarehouseStockHint({
        supplierSku: "U990VR6",
        providerKey: "NER_7612345678901",
        offerSupplierSku: "NER_7612345678901",
      })
    ).toBe("NER_STOCK");
  });

  it("detects NER from raw EDI supplierSku", () => {
    expect(
      galaxusLineWarehouseStockHint({
        supplierSku: "NER_7612345678901",
        providerKey: "NER_7612345678901",
      })
    ).toBe("NER_STOCK");
  });

  it("detects THE from providerKey", () => {
    expect(
      galaxusLineWarehouseStockHint({
        supplierSku: "BQ6546-011",
        providerKey: "THE_7612345678901",
        offerSupplierSku: "THE_7612345678901",
      })
    ).toBe("MAISON");
  });

  it("returns null for STX style sku without warehouse prefix", () => {
    expect(
      galaxusLineWarehouseStockHint({
        supplierSku: "U9060ASP",
        providerKey: "STX_7612345678901",
        offerSupplierSku: "STX_7612345678901",
      })
    ).toBeNull();
  });
});

describe("resolveGalaxusLineOfferSupplierSku", () => {
  it("prefers NER_/THE_ raw line sku over providerKey", () => {
    expect(
      resolveGalaxusLineOfferSupplierSku({
        supplierSku: "NER_123",
        providerKey: "NER_456",
      })
    ).toBe("NER_123");
  });
});
