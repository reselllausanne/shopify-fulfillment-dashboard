import { describe, expect, it } from "vitest";
import {
  shouldSkipGalaxusFeedCheckAll,
  skipGalaxusFeedValidationForSnapshotExport,
  skipGalaxusFeedValidationForTrigger,
} from "@/galaxus/feedExecutor";

describe("skipGalaxusFeedValidationForTrigger", () => {
  it("skips validation on post-sale triggers only", () => {
    expect(skipGalaxusFeedValidationForTrigger("shopify-post-sale")).toBe(true);
    expect(skipGalaxusFeedValidationForTrigger("inventory-sync")).toBe(true);
    expect(skipGalaxusFeedValidationForTrigger("manual")).toBe(false);
    expect(skipGalaxusFeedValidationForTrigger("scraper")).toBe(false);
    expect(skipGalaxusFeedValidationForTrigger(null)).toBe(false);
  });
});

describe("skipGalaxusFeedValidationForSnapshotExport", () => {
  it("skips stock/offer snapshot exports without master/specs", () => {
    expect(
      skipGalaxusFeedValidationForSnapshotExport({ stockFromSnapshot: true })
    ).toBe(true);
    expect(
      skipGalaxusFeedValidationForSnapshotExport({
        stockFromSnapshot: true,
        offerFromSnapshot: true,
      })
    ).toBe(true);
    expect(
      skipGalaxusFeedValidationForSnapshotExport({
        stockFromSnapshot: true,
        needsMaster: true,
      })
    ).toBe(false);
    expect(skipGalaxusFeedValidationForSnapshotExport({})).toBe(false);
  });
});

describe("shouldSkipGalaxusFeedCheckAll", () => {
  it("combines trigger and snapshot skip rules", () => {
    expect(
      shouldSkipGalaxusFeedCheckAll({
        triggerSource: "manual",
        stockFromSnapshot: true,
      })
    ).toBe(true);
    expect(
      shouldSkipGalaxusFeedCheckAll({
        triggerSource: "manual",
        stockFromSnapshot: false,
      })
    ).toBe(false);
    expect(
      shouldSkipGalaxusFeedCheckAll({
        triggerSource: "shopify-post-sale",
        stockFromSnapshot: false,
      })
    ).toBe(true);
  });
});
