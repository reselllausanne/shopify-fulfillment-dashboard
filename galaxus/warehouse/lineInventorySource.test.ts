import { describe, expect, it } from "vitest";
import {
  galaxusLineWarehouseStockHint,
  isCrocsLightningMcQueenLine,
  isGalaxusGldSupplierLine,
  isGalaxusStxSupplierLine,
} from "@/galaxus/warehouse/lineInventorySource";

describe("GLD / Golden line detection", () => {
  it("detects GLD provider / golden variant ids", () => {
    expect(isGalaxusGldSupplierLine({ providerKey: "GLD_4067907638404" })).toBe(true);
    expect(isGalaxusGldSupplierLine({ supplierPid: "GLD_123" })).toBe(true);
    expect(isGalaxusGldSupplierLine({ supplierVariantId: "golden:15456" })).toBe(true);
    expect(isGalaxusGldSupplierLine({ supplierSku: "GLD_foo" })).toBe(true);
    expect(isGalaxusGldSupplierLine({ providerKey: "STX_abc" })).toBe(false);
  });

  it("never treats GLD as StockX", () => {
    expect(
      isGalaxusStxSupplierLine({
        providerKey: "GLD_4067",
        supplierVariantId: "golden:1",
      })
    ).toBe(false);
  });

  it("surfaces GOLDEN warehouse hint", () => {
    expect(galaxusLineWarehouseStockHint({ providerKey: "GLD_4067" })).toBe("GOLDEN");
    expect(galaxusLineWarehouseStockHint({ supplierVariantId: "golden:9" })).toBe("GOLDEN");
    expect(galaxusLineWarehouseStockHint({ supplierSku: "THE_x" })).toBe("MAISON");
  });

  it("AF1 White STX listing → GOLDEN buy-source override (no StockX)", () => {
    expect(galaxusLineWarehouseStockHint({ providerKey: "STX_0194500874923" })).toBe("GOLDEN");
    expect(galaxusLineWarehouseStockHint({ gtin: "0194500874947" })).toBe("GOLDEN");
    expect(
      isGalaxusStxSupplierLine({
        providerKey: "STX_0194500874961",
        gtin: "0194500874961",
      })
    ).toBe(false);
    expect(isGalaxusStxSupplierLine({ providerKey: "STX_194500874848" })).toBe(true);
  });

  it("blocks Crocs Lightning McQueen from StockX even when listed STX_", () => {
    expect(
      isCrocsLightningMcQueenLine({
        productName: "Crocs Lightning McQueen (41, 42)",
        gtin: "191448430945",
        providerKey: "STX_191448430945",
      })
    ).toBe(true);
    expect(
      isGalaxusStxSupplierLine({
        providerKey: "STX_191448430945",
        gtin: "191448430945",
        productName: "Crocs Lightning McQueen (41, 42)",
      })
    ).toBe(false);
  });
});
