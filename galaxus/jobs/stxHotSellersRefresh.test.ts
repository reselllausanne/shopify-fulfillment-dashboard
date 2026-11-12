import { afterEach, describe, expect, it } from "vitest";
import { resolveStxHotSellersRefreshOptions } from "@/galaxus/jobs/stxHotSellersRefresh";

describe("resolveStxHotSellersRefreshOptions", () => {
  afterEach(() => {
    delete process.env.STX_HOT_LOOKBACK_DAYS;
    delete process.env.STX_HOT_MIN_QTY;
    delete process.env.STX_HOT_LIMIT_PRODUCTS;
    delete process.env.STX_HOT_CONCURRENCY;
  });

  it("defaults to 14d / min 1 / 400 products / concurrency 4", () => {
    expect(resolveStxHotSellersRefreshOptions()).toEqual({
      lookbackDays: 14,
      minQty: 1,
      limitProducts: 400,
      concurrency: 4,
    });
  });

  it("reads env overrides with caps", () => {
    process.env.STX_HOT_LOOKBACK_DAYS = "21";
    process.env.STX_HOT_MIN_QTY = "2";
    process.env.STX_HOT_LIMIT_PRODUCTS = "9999";
    process.env.STX_HOT_CONCURRENCY = "12";
    expect(resolveStxHotSellersRefreshOptions()).toEqual({
      lookbackDays: 21,
      minQty: 2,
      limitProducts: 2000,
      concurrency: 12,
    });
  });
});
