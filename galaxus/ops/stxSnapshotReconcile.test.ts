import { describe, expect, it } from "vitest";
import { calcGalaxusStxSellFromSourceCost } from "@/galaxus/exports/pricing";
import {
  chunk,
  isStxOfferPriceMismatch,
  isStxSnapshotLossPrice,
  stxReconcileConfigFromEnv,
} from "@/galaxus/ops/stxSnapshotReconcile";

const cfg = { relTolerance: 0.02, absToleranceChf: 0.5 };

describe("isStxOfferPriceMismatch", () => {
  it("accepts snapshot equal to locked formula", () => {
    const sell = calcGalaxusStxSellFromSourceCost(253)!;
    expect(isStxOfferPriceMismatch(sell, 253, cfg)).toBe(false);
  });
  it("flags the Phantom case (67.53 vs cost 253)", () => {
    expect(isStxOfferPriceMismatch(67.53, 253, cfg)).toBe(true);
  });
  it("flags the Magia EU36.5 case (86.46 vs cost 267.86)", () => {
    expect(isStxOfferPriceMismatch(86.46, 267.86, cfg)).toBe(true);
  });
  it("tolerates sub-tolerance drift", () => {
    const sell = calcGalaxusStxSellFromSourceCost(100)!;
    expect(isStxOfferPriceMismatch(sell + 0.3, 100, cfg)).toBe(false);
  });
  it("ignores invalid DB price", () => {
    expect(isStxOfferPriceMismatch(10, 0, cfg)).toBe(false);
  });
});

describe("isStxSnapshotLossPrice", () => {
  it("flags the Zegama case: file at 70.05 while the buy is 212", () => {
    expect(
      isStxSnapshotLossPrice({ snapshotPriceChf: 70.05, dbBuyChf: 212.42 })
    ).toBe(true);
  });
  it("ignores a locked wholesale price", () => {
    expect(
      isStxSnapshotLossPrice({ snapshotPriceChf: 69, dbBuyChf: 225, manualLock: true })
    ).toBe(false);
  });
  it("does not flag a price on the locked formula", () => {
    const sell = calcGalaxusStxSellFromSourceCost(205.89)!;
    expect(isStxSnapshotLossPrice({ snapshotPriceChf: sell, dbBuyChf: 205.89 })).toBe(false);
  });
});

describe("helpers", () => {
  it("chunks", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("config defaults + overrides", () => {
    expect(stxReconcileConfigFromEnv({} as NodeJS.ProcessEnv).maxKeys).toBe(5000);
    expect(
      stxReconcileConfigFromEnv({ GALAXUS_STX_RECONCILE_MAX_KEYS: "100" } as unknown as NodeJS.ProcessEnv).maxKeys
    ).toBe(100);
  });
});
