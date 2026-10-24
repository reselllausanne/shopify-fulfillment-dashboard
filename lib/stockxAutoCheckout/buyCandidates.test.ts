import { describe, expect, it } from "vitest";
import {
  applyBudget,
  defaultSinceDate,
  rankCandidates,
  type BuyCandidate,
} from "@/lib/stockxAutoCheckout/buyCandidates";
import type { PrecheckResult } from "@/lib/stockxAutoCheckout/precheckAvailability";
import type { StockxPrecheckStatus } from "@/lib/stockxAutoCheckout/types";

function candidate(
  orderName: string,
  opts: { express?: boolean; status?: StockxPrecheckStatus; buy?: number; date?: string } = {}
): BuyCandidate {
  const precheck: PrecheckResult = {
    status: opts.status ?? "buyable",
    lane: opts.express ? "EXPRESS" : "STANDARD",
    expectedBuyChf: opts.buy ?? 100,
    stock: 2,
    sellChf: 300,
    marginPct: 0.3,
    detail: "buyable",
    supplierVariantId: "stx_x",
  };
  return {
    orderName,
    orderDate: new Date(opts.date ?? "2026-10-10T00:00:00.000Z"),
    shopifyLineItemId: `${orderName}-li`,
    title: `Item ${orderName}`,
    sizeEU: "EU 42",
    express: opts.express ?? false,
    precheck,
  };
}

describe("defaultSinceDate", () => {
  it("is Oct 1 (UTC) of the given year", () => {
    const d = defaultSinceDate(new Date("2026-05-15T00:00:00.000Z"));
    expect(d.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("rankCandidates", () => {
  it("express first, stable (preserves oldest-first within each group)", () => {
    const input = [
      candidate("#1", { express: false }),
      candidate("#2", { express: true }),
      candidate("#3", { express: false }),
      candidate("#4", { express: true }),
    ];
    expect(rankCandidates(input).map((c) => c.orderName)).toEqual(["#2", "#4", "#1", "#3"]);
  });
});

describe("applyBudget", () => {
  it("only buyable lines, stops when cumulative would exceed budget", () => {
    const ranked = [
      candidate("#1", { buy: 400 }),
      candidate("#2", { buy: 400 }),
      candidate("#3", { buy: 400 }),
    ];
    const { selected, totalBuyChf } = applyBudget(ranked, { budgetChf: 1000 });
    expect(selected.map((c) => c.orderName)).toEqual(["#1", "#2"]);
    expect(totalBuyChf).toBe(800);
  });

  it("skips non-buyable statuses", () => {
    const ranked = [
      candidate("#1", { status: "too_expensive", buy: 100 }),
      candidate("#2", { status: "buyable", buy: 100 }),
      candidate("#3", { status: "oos_no_ask", buy: null as unknown as number }),
    ];
    const { selected } = applyBudget(ranked, {});
    expect(selected.map((c) => c.orderName)).toEqual(["#2"]);
  });

  it("maxSelected caps the count", () => {
    const ranked = [
      candidate("#1", { buy: 10 }),
      candidate("#2", { buy: 10 }),
      candidate("#3", { buy: 10 }),
    ];
    const { selected } = applyBudget(ranked, { maxSelected: 2 });
    expect(selected.map((c) => c.orderName)).toEqual(["#1", "#2"]);
  });

  it("no budget → all buyable included", () => {
    const ranked = [candidate("#1", { buy: 999 }), candidate("#2", { buy: 999 })];
    const { selected, totalBuyChf } = applyBudget(ranked, {});
    expect(selected).toHaveLength(2);
    expect(totalBuyChf).toBe(1998);
  });
});
