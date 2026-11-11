import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/prisma", () => ({ prisma: {} }));

import { EMPTY_LINES_TTL_MS, cacheEntryFresh, isCancelledStatus, normName, orderIsBuyable, skuCandidates } from "@/lib/stockxBuyer/shopifyQueue";

describe("skuCandidates", () => {
  it("tries the full colour-coded style id first, then shorter prefixes", () => {
    expect(skuCandidates("DM1275-250")).toEqual(["DM1275-250", "DM1275"]);
    expect(skuCandidates("HQ2592-005-44")).toEqual(["HQ2592-005-44", "HQ2592-005", "HQ2592"]);
  });
  it("strips letter and numeric size suffixes", () => {
    expect(skuCandidates("HF6248-002-43")[1]).toBe("HF6248-002");
    expect(skuCandidates("ABC123-001-XL")[1]).toBe("ABC123-001");
  });
  it("empty in, empty out", () => {
    expect(skuCandidates("  ")).toEqual([]);
  });
});

describe("orderIsBuyable", () => {
  it("rejects refunded, zero and fully refunded orders", () => {
    expect(orderIsBuyable({ financialStatus: "REFUNDED", netSalesChf: 0, totalSalesChf: 100 })).toBe(false);
    expect(orderIsBuyable({ financialStatus: "PAID", netSalesChf: 0, totalSalesChf: 100 })).toBe(false);
    expect(orderIsBuyable({ financialStatus: "PAID", netSalesChf: 100, totalSalesChf: 100, refundedAmountChf: 100 })).toBe(false);
  });
  it("accepts paid and partially refunded orders", () => {
    expect(orderIsBuyable({ financialStatus: "PAID", netSalesChf: 100, totalSalesChf: 100 })).toBe(true);
    expect(orderIsBuyable({ financialStatus: "PARTIALLY_REFUNDED", netSalesChf: 80, totalSalesChf: 100, refundedAmountChf: 20 })).toBe(true);
  });
});

describe("normName", () => {
  it("adds the hash", () => {
    expect(normName("7661")).toBe("#7661");
    expect(normName("#7661")).toBe("#7661");
  });
});

describe("cacheEntryFresh", () => {
  const line = { lineItemId: "1", title: "t", sku: "s", sizeEU: "42", express: false, skip: false, saleChf: 1 };
  it("non-empty cache never expires (lines do not change after the sale)", () => {
    expect(cacheEntryFresh({ at: 0, lines: [line] }, 10 * EMPTY_LINES_TTL_MS)).toBe(true);
  });
  it("empty cache expires so fulfilled orders are not re-fetched every cycle but not forgotten", () => {
    expect(cacheEntryFresh({ at: 0, lines: [] }, 1000)).toBe(true);
    expect(cacheEntryFresh({ at: 0, lines: [] }, EMPTY_LINES_TTL_MS + 1)).toBe(false);
    expect(cacheEntryFresh(undefined, 0)).toBe(false);
  });
});

describe("isCancelledStatus", () => {
  it("cancelled and refunded StockX orders belong to the rebuy sweep", () => {
    expect(isCancelledStatus("CANCELLED")).toBe(true);
    expect(isCancelledStatus("Order Refunded")).toBe(true);
    expect(isCancelledStatus("SHIPPED")).toBe(false);
    expect(isCancelledStatus(null)).toBe(false);
  });
});
