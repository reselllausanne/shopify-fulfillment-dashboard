import { describe, expect, it } from "vitest";
import {
  isDeadFeedBlocked,
  isDeadSupplier,
  resolveDeadSupplierKey,
  shouldForceDeadStockZero,
} from "@/galaxus/exports/deadSupplierKill";

describe("deadSupplierKill", () => {
  it("detects bae/hhv/snl/nso", () => {
    expect(resolveDeadSupplierKey({ supplierVariantId: "bae_1" })).toBe("bae");
    expect(resolveDeadSupplierKey({ providerKey: "HHV_1" })).toBe("hhv");
    expect(resolveDeadSupplierKey({ supplierKey: "snl" })).toBe("snl");
    expect(resolveDeadSupplierKey({ supplierVariantId: "nso_x" })).toBe("nso");
    expect(isDeadSupplier({ supplierVariantId: "fan_1" })).toBe(false);
  });

  it("blocks master/offer and forces stock zero", () => {
    expect(isDeadFeedBlocked({ providerKey: "SNL_1" })).toBe(true);
    expect(shouldForceDeadStockZero({ supplierVariantId: "snl_1" })).toBe(true);
    expect(shouldForceDeadStockZero({ supplierKey: "wel" })).toBe(false);
  });
});
