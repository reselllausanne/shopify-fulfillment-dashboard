import { describe, expect, it } from "vitest";
import {
  BAE_DELETE_CONFIRM_TOKEN,
  isBaeFeedBlocked,
  isBaeSupplierKey,
  shouldForceBaeStockZero,
  summarizeBaeActiveListings,
} from "@/galaxus/exports/baeKill";

describe("baeKill", () => {
  it("detects bae via supplierVariantId / providerKey / supplierKey", () => {
    expect(isBaeSupplierKey({ supplierVariantId: "bae_7619876557124" })).toBe(true);
    expect(isBaeSupplierKey({ providerKey: "BAE_7619876557124" })).toBe(true);
    expect(isBaeSupplierKey({ supplierKey: "bae" })).toBe(true);
    expect(isBaeSupplierKey({ supplierVariantId: "fan_1" })).toBe(false);
  });

  it("blocks master/offer and forces stock zero for delist", () => {
    expect(isBaeFeedBlocked({ supplierVariantId: "bae_1" })).toBe(true);
    expect(shouldForceBaeStockZero({ providerKey: "BAE_1" })).toBe(true);
    expect(shouldForceBaeStockZero({ supplierKey: "wel" })).toBe(false);
  });

  it("summarizes listing totals", () => {
    const summary = summarizeBaeActiveListings([
      {
        providerKey: "BAE_1",
        gtin: "1",
        supplierVariantId: "bae_1",
        lastPushedStock: 1,
        status: "ACTIVE",
        channel: "GALAXUS",
      },
      {
        providerKey: "BAE_2",
        gtin: "2",
        supplierVariantId: "bae_2",
        lastPushedStock: 0,
        status: "SOLD_OUT",
        channel: "GALAXUS",
      },
    ]);
    expect(summary.total).toBe(2);
    expect(summary.byStatus.ACTIVE).toBe(1);
    expect(BAE_DELETE_CONFIRM_TOKEN).toBe("BAE_DELETE");
  });
});
