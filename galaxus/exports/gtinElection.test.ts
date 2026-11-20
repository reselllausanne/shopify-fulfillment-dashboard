import { beforeEach, describe, expect, it, vi } from "vitest";

const mappingFindMany = vi.fn();
const offerSnapFindMany = vi.fn();
vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    variantMapping: { findMany: (...a: unknown[]) => mappingFindMany(...a) },
    galaxusFeedOfferSnapshot: { findMany: (...a: unknown[]) => offerSnapFindMany(...a) },
  },
}));

import {
  expandProviderKeysWithGtinSiblings,
  findGtinElectionLosers,
  gtinCore,
  gtinOfProviderKey,
  gtinSpellings,
  liveWinnerKeyByGtin,
} from "@/galaxus/exports/gtinElection";

describe("gtinCore / gtinSpellings", () => {
  it("UPC-12, EAN-13 and GTIN-14 spellings share one core", () => {
    expect(gtinCore("198730461243")).toBe("198730461243");
    expect(gtinCore("0198730461243")).toBe("198730461243");
    expect(gtinCore("00198730461243")).toBe("198730461243");
    expect(gtinCore("4067892061461")).toBe("4067892061461");
  });
  it("rejects non-GTIN lengths", () => {
    expect(gtinCore("12345")).toBeNull();
    expect(gtinCore("abc")).toBeNull();
    expect(gtinCore("")).toBeNull();
  });
  it("lists every spelling Galaxus or a supplier may use", () => {
    expect(gtinSpellings("0198730461243")).toEqual([
      "198730461243",
      "0198730461243",
      "00198730461243",
    ]);
  });
});

const G = "194513902217";
const stock = (key: string, qty: number) => ({ ProviderKey: key, QuantityOnStock: String(qty) });
const offer = (key: string, price: number) => ({ ProviderKey: key, PurchasePriceExclVat_CHF: price.toFixed(2) });

describe("gtinOfProviderKey", () => {
  it("reads the GTIN suffix", () => {
    expect(gtinOfProviderKey(`STX_${G}`)).toBe(G);
    expect(gtinOfProviderKey(`NER_00${G}`)).toBe(`00${G}`);
  });
  it("rejects keys without a GTIN suffix", () => {
    expect(gtinOfProviderKey("STX_SV_8c7367ca")).toBeNull();
    expect(gtinOfProviderKey("STX")).toBeNull();
    expect(gtinOfProviderKey("")).toBeNull();
  });
});

describe("findGtinElectionLosers", () => {
  it("STX refresh loses to cheaper in-stock NER", () => {
    const losers = findGtinElectionLosers(
      [`STX_${G}`, `NER_${G}`],
      [stock(`NER_${G}`, 3), stock(`STX_${G}`, 0)],
      [offer(`NER_${G}`, 50)]
    );
    expect(Array.from(losers)).toEqual([`STX_${G}`]);
  });

  it("winner published at 0 does not cover the GTIN", () => {
    const losers = findGtinElectionLosers(
      [`STX_${G}`, `NER_${G}`],
      [stock(`NER_${G}`, 0)],
      [offer(`NER_${G}`, 50)]
    );
    expect(losers.size).toBe(0);
  });

  it("no live sibling = export blip, not a loser", () => {
    expect(findGtinElectionLosers([`STX_${G}`], [], []).size).toBe(0);
  });

  it("emitted keys are never losers", () => {
    const losers = findGtinElectionLosers(
      [`STX_${G}`],
      [stock(`STX_${G}`, 2)],
      [offer(`STX_${G}`, 95.28)]
    );
    expect(losers.size).toBe(0);
  });

  it("matches the same product across GTIN spellings", () => {
    const losers = findGtinElectionLosers(
      ["NER_198730461243", "NER_0198730461243", "STX_0198730461243"],
      [stock("STX_0198730461243", 8)],
      [offer("STX_0198730461243", 147.02)]
    );
    expect(Array.from(losers).sort()).toEqual(["NER_0198730461243", "NER_198730461243"]);
  });

  it("needs both offer and positive stock for the winner", () => {
    const winners = liveWinnerKeyByGtin([stock(`NER_${G}`, 3)], []);
    expect(winners.size).toBe(0);
  });
});

describe("expandProviderKeysWithGtinSiblings", () => {
  beforeEach(() => {
    mappingFindMany.mockReset();
    offerSnapFindMany.mockReset().mockResolvedValue([]);
  });

  it("adds same-GTIN keys from other suppliers", async () => {
    mappingFindMany.mockResolvedValue([
      { gtin: G, providerKey: `STX_${G}` },
      { gtin: G, providerKey: `NER_${G}` },
    ]);
    const res = await expandProviderKeysWithGtinSiblings([`STX_${G}`, "STX_4006381333931"]);
    expect(res.keys.sort()).toEqual([`NER_${G}`, `STX_${G}`, "STX_4006381333931"].sort());
    expect(res.siblingsByKey.get(`STX_${G}`)).toEqual([`NER_${G}`]);
    expect(res.siblingsByKey.has("STX_4006381333931")).toBe(false);
    expect(mappingFindMany).toHaveBeenCalledTimes(1);
  });

  it("finds the UPC-12 mapping and the published listing alias of an EAN-13 key", async () => {
    mappingFindMany.mockImplementation(async ({ where }: any) => {
      expect(where.gtin.in).toEqual(["198730461243", "0198730461243", "00198730461243"]);
      return [
        { gtin: "0198730461243", providerKey: "STX_0198730461243" },
        { gtin: "198730461243", providerKey: "NER_198730461243" },
      ];
    });
    offerSnapFindMany.mockResolvedValue([
      { providerKey: "STX_0198730461243" },
      { providerKey: "NER_0198730461243" },
    ]);
    const res = await expandProviderKeysWithGtinSiblings(["STX_0198730461243"]);
    expect(res.keys.sort()).toEqual(["NER_198730461243", "STX_0198730461243"]);
    expect(res.publishedSiblings).toEqual(["NER_0198730461243"]);
    expect(res.siblingsByKey.get("STX_0198730461243")?.sort()).toEqual([
      "NER_0198730461243",
      "NER_198730461243",
    ]);
  });

  it("skips the lookup when no key carries a GTIN", async () => {
    const res = await expandProviderKeysWithGtinSiblings(["STX_SV_abc"]);
    expect(res.keys).toEqual(["STX_SV_abc"]);
    expect(mappingFindMany).not.toHaveBeenCalled();
  });
});
