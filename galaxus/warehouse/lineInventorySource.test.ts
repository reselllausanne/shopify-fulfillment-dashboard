import { describe, expect, it } from "vitest";
import {
  galaxusLineWarehouseStockHint,
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
});
