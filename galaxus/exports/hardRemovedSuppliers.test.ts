import { afterEach, describe, expect, it } from "vitest";
import {
  galaxusHardRemovedSuppliers,
  isHardRemovedProviderKey,
} from "@/galaxus/exports/hardRemovedSuppliers";
import { galaxusAssortmentBlockReason } from "@/galaxus/exports/assortmentPolicy";
import { filterAlternativeProducts, type AlternativeProductRecord } from "@/galaxus/exports/alternative";
import { buildMasterRowsFromCandidates, buildSpecsRowsFromCandidates } from "@/galaxus/exports/masterSpecsFeed";

afterEach(() => {
  delete process.env.GALAXUS_DISABLED_SUPPLIERS;
});

const REMOVED = ["ALT", "HAW", "EXL", "VEN", "WRK", "FAN", "BAE", "BWZ"];

describe("hard-removed suppliers (2026-11-11)", () => {
  it("default set is exactly the 8 requested suppliers; stx/ner/rei/wel/xnt untouched", () => {
    expect([...galaxusHardRemovedSuppliers()].sort()).toEqual(REMOVED.map((s) => s.toLowerCase()).sort());
    for (const k of ["STX", "NER", "REI", "WEL", "XNT", "GLD"]) {
      expect(isHardRemovedProviderKey(`${k}_123`)).toBe(false);
    }
    for (const k of REMOVED) expect(isHardRemovedProviderKey(`${k}_123`)).toBe(true);
  });

  it("GALAXUS_DISABLED_SUPPLIERS override reopens them (escape hatch)", () => {
    process.env.GALAXUS_DISABLED_SUPPLIERS = "rei";
    expect(galaxusHardRemovedSuppliers().size).toBe(0);
    expect(isHardRemovedProviderKey("HAW_1")).toBe(false);
  });

  it("stock/offer policy blocks every removed supplier as supplier_disabled", () => {
    for (const k of REMOVED) {
      expect(
        galaxusAssortmentBlockReason({ providerKey: `${k}_4012345678901`, title: "Anything", brand: "X", purchasePriceExVatChf: 20 })
      ).toBe("supplier_disabled");
    }
  });

  it("alternatives (ALT/FAN/EXL…) are dropped from master/specs when galaxusHardRemove is set", () => {
    const mk = (providerKey: string): AlternativeProductRecord =>
      ({
        id: providerKey,
        externalKey: providerKey,
        gtin: "4006381333931",
        providerKey,
        brand: "B",
        title: "T",
        category: "",
        description: "",
        size: null,
        priceExVat: 10,
        vatRate: 0.081,
      }) as unknown as AlternativeProductRecord;
    const alternatives = [mk("ALT_4006381333931"), mk("NER_4006381333931")];
    const withFlag = filterAlternativeProducts({
      alternatives,
      normalByGtin: new Map(),
      normalByProviderKey: new Map(),
      galaxusHardRemove: true,
    });
    expect(withFlag.exportable.map((p) => p.providerKey)).toEqual(["NER_4006381333931"]);
    const without = filterAlternativeProducts({
      alternatives,
      normalByGtin: new Map(),
      normalByProviderKey: new Map(),
    });
    expect(without.exportable).toHaveLength(2); // Decathlon path unchanged
  });

  it("master/specs builders skip removed suppliers by provider key", () => {
    const cand = (providerKey: string, svid: string) =>
      ({
        providerKey,
        gtin: "4006381333931",
        sellPriceExVat: 10,
        variant: { supplierVariantId: svid, supplierProductName: "x" },
        product: null,
        mapping: { gtin: "4006381333931" },
      }) as any;
    const candidates = [cand("HAW_4006381333931", "haw_4006381333931")];
    expect(buildMasterRowsFromCandidates(candidates, new Map(), false, false, new Map())).toEqual([]);
    expect(buildSpecsRowsFromCandidates(candidates)).toEqual([]);
  });
});
