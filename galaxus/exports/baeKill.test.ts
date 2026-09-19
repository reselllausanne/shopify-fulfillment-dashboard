import { describe, expect, it } from "vitest";
import {
  BAE_DELIST_CONFIRM_TOKEN,
  buildBaeDelistStockCsv,
  isBaeFeedBlocked,
  isBaeSupplierKey,
  summarizeBaeActiveListings,
} from "@/galaxus/exports/baeKill";

describe("baeKill", () => {
  it("detects bae via supplierVariantId / providerKey / supplierKey", () => {
    expect(isBaeSupplierKey({ supplierVariantId: "bae_7619876557124" })).toBe(true);
    expect(isBaeSupplierKey({ providerKey: "BAE_7619876557124" })).toBe(true);
    expect(isBaeSupplierKey({ supplierKey: "bae" })).toBe(true);
    expect(isBaeSupplierKey({ supplierVariantId: "fan_1" })).toBe(false);
    expect(isBaeSupplierKey({ providerKey: "FAN_1" })).toBe(false);
  });

  it("blocks bae from future feeds without implying auto stock-zero", () => {
    expect(isBaeFeedBlocked({ supplierVariantId: "bae_1" })).toBe(true);
    expect(isBaeFeedBlocked({ supplierKey: "wel" })).toBe(false);
  });

  it("summarizes dry-run listing totals", () => {
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
        lastPushedStock: 3,
        status: "ACTIVE",
        channel: "GALAXUS",
      },
      {
        providerKey: "BAE_3",
        gtin: null,
        supplierVariantId: "bae_3",
        lastPushedStock: 0,
        status: "SOLD_OUT",
        channel: "GALAXUS",
      },
    ]);
    expect(summary.total).toBe(3);
    expect(summary.byStatus.ACTIVE).toBe(2);
    expect(summary.byStatus.SOLD_OUT).toBe(1);
    expect(summary.providerKeys).toEqual(["BAE_1", "BAE_2", "BAE_3"]);
  });

  it("builds delist stock CSV for explicit apply only", () => {
    expect(BAE_DELIST_CONFIRM_TOKEN).toBe("BAE_DELIST_GALAXUS");
    expect(buildBaeDelistStockCsv(["BAE_1", "BAE_2"])).toBe(
      "ProviderKey,QuantityOnStock\nBAE_1,0\nBAE_2,0\n"
    );
  });
});
