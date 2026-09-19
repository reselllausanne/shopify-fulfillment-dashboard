import { describe, expect, it } from "vitest";
import {
  BAE_DELETE_CONFIRM_TOKEN,
  BAE_DELIST_CONFIRM_TOKEN,
  isBaeFeedBlocked,
  isBaeStockZeroArmed,
  isBaeSupplierKey,
  shouldForceBaeStockZero,
  summarizeBaeActiveListings,
} from "@/galaxus/exports/baeKill";
import { shouldForceDeadStockZero } from "@/galaxus/exports/deadSupplierKill";

describe("baeKill", () => {
  it("detects bae via supplierVariantId / providerKey / supplierKey", () => {
    expect(isBaeSupplierKey({ supplierVariantId: "bae_7619876557124" })).toBe(true);
    expect(isBaeSupplierKey({ providerKey: "BAE_7619876557124" })).toBe(true);
    expect(isBaeSupplierKey({ supplierKey: "bae" })).toBe(true);
    expect(isBaeSupplierKey({ supplierVariantId: "fan_1" })).toBe(false);
  });

  it("blocks master/offer always; stock zero only when armed", () => {
    expect(isBaeFeedBlocked({ supplierVariantId: "bae_1" })).toBe(true);
    expect(shouldForceBaeStockZero({ providerKey: "BAE_1" }, {})).toBe(false);
    expect(shouldForceBaeStockZero({ providerKey: "BAE_1" }, { BAE_GALAXUS_STOCK_ZERO: "1" })).toBe(
      true
    );
    expect(isBaeStockZeroArmed({ BAE_GALAXUS_STOCK_ZERO: "1" })).toBe(true);
    // Auto dead-zero must NOT include BAE (dry-run/apply gate).
    expect(shouldForceDeadStockZero({ providerKey: "BAE_1" })).toBe(false);
    expect(shouldForceDeadStockZero({ providerKey: "SNL_1" })).toBe(true);
  });

  it("summarizes listing totals and feed impact", () => {
    const summary = summarizeBaeActiveListings([
      {
        providerKey: "BAE_1",
        gtin: "1",
        supplierVariantId: "bae_1",
        lastPushedStock: 1,
        dbStock: 5,
        status: "ACTIVE",
        channel: "GALAXUS",
      },
      {
        providerKey: "BAE_2",
        gtin: "2",
        supplierVariantId: "bae_2",
        lastPushedStock: 0,
        dbStock: 0,
        status: "SOLD_OUT",
        channel: "GALAXUS",
      },
    ]);
    expect(summary.total).toBe(2);
    expect(summary.withPositivePushedStock).toBe(1);
    expect(summary.withPositiveDbStock).toBe(1);
    expect(summary.byStatus.ACTIVE).toBe(1);
    expect(BAE_DELETE_CONFIRM_TOKEN).toBe("BAE_DELETE");
    expect(BAE_DELIST_CONFIRM_TOKEN).toBe("BAE_DELIST");
  });
});
