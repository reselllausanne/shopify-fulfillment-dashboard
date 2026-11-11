import { describe, expect, it } from "vitest";
import { calcGalaxusStxSellFromSourceCost } from "@/galaxus/exports/pricing";
import {
  chunk,
  isStxOfferPriceMismatch,
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
  it("tolerates sub-tolerance drift", () => {
    const sell = calcGalaxusStxSellFromSourceCost(100)!;
    expect(isStxOfferPriceMismatch(sell + 0.3, 100, cfg)).toBe(false);
  });
  it("ignores invalid DB price", () => {
    expect(isStxOfferPriceMismatch(10, 0, cfg)).toBe(false);
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
