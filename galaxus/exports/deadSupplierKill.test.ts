import { describe, expect, it } from "vitest";
import {
  isBaeManualWarehouseFeedAllowed,
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

  it("blocks master/offer for all dead; auto stock-zero excludes BAE", () => {
    expect(isDeadFeedBlocked({ providerKey: "SNL_1" })).toBe(true);
    expect(isDeadFeedBlocked({ providerKey: "BAE_1" })).toBe(true);
    expect(shouldForceDeadStockZero({ supplierVariantId: "snl_1" })).toBe(true);
    expect(shouldForceDeadStockZero({ providerKey: "BAE_1" })).toBe(false);
    expect(shouldForceDeadStockZero({ supplierKey: "wel" })).toBe(false);
  });

  it("allows BAE warehouse rows with manualLock + priced shelf + stock", () => {
    expect(
      isBaeManualWarehouseFeedAllowed({
        supplierVariantId: "bae_623555897811",
        manualLock: true,
        manualPrice: 82.33,
        manualStock: 1,
      })
    ).toBe(true);
    expect(
      isBaeManualWarehouseFeedAllowed({
        supplierVariantId: "bae_1",
        manualLock: true,
        manualPrice: 82.33,
        manualStock: 0,
        stock: 0,
      })
    ).toBe(false);
    expect(
      isBaeManualWarehouseFeedAllowed({
        supplierVariantId: "bae_1",
        manualLock: false,
        manualPrice: 82.33,
        manualStock: 1,
      })
    ).toBe(false);
    expect(
      isBaeManualWarehouseFeedAllowed({
        supplierVariantId: "stx_1",
        manualLock: true,
        manualPrice: 82.33,
        manualStock: 1,
      })
    ).toBe(false);
  });
});
