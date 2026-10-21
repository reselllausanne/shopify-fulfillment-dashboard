import { describe, expect, it } from "vitest";
import {
  addDaysYmd,
  cutoffSellDateKey,
  filterByLag,
  getBuyLagDays,
  oldestCohort,
  planBuyQueueFromOrders,
  zurichMonthBounds,
  zurichSellDateKey,
  zurichTodayKey,
  type UnlinkedQueueOrder,
} from "@/lib/stockxAutoCheckout/queue";

function order(
  name: string,
  createdAtIso: string,
  net = 100
): UnlinkedQueueOrder {
  const createdAt = new Date(createdAtIso);
  return {
    shopifyOrderId: `gid://shopify/Order/${name}`,
    orderName: name,
    createdAt,
    sellDateKey: zurichSellDateKey(createdAt),
    netSalesChf: net,
  };
}

describe("getBuyLagDays", () => {
  it("defaults to 5", () => {
    expect(getBuyLagDays(undefined)).toBe(5);
    expect(getBuyLagDays("")).toBe(5);
  });

  it("reads env override and clamps", () => {
    expect(getBuyLagDays("4")).toBe(4);
    expect(getBuyLagDays("0")).toBe(0);
    expect(getBuyLagDays("99")).toBe(30);
    expect(getBuyLagDays("-3")).toBe(0);
  });
});

describe("addDaysYmd / cutoff", () => {
  it("subtracts lag from today", () => {
    expect(cutoffSellDateKey("2026-10-21", 5)).toBe("2026-10-16");
    expect(addDaysYmd("2026-10-01", -1)).toBe("2026-09-30");
  });
});

describe("zurich month bounds", () => {
  it("Oct 2026 Zurich month starts Oct 1 00:00 Zurich", () => {
    // 2026-10-15 12:00 UTC ≈ afternoon Zurich
    const { monthKey, start, endExclusive } = zurichMonthBounds(
      new Date("2026-10-15T12:00:00.000Z")
    );
    expect(monthKey).toBe("2026-10");
    expect(zurichSellDateKey(start)).toBe("2026-10-01");
    expect(zurichSellDateKey(endExclusive)).toBe("2026-11-01");
  });

  it("rolls to November after Zurich midnight", () => {
    // After 2026 DST end (CET=UTC+1): 2026-10-31 23:30 UTC = Nov 1 00:30 Zurich
    const nov = zurichMonthBounds(new Date("2026-10-31T23:30:00.000Z"));
    expect(nov.monthKey).toBe("2026-11");
  });
});

describe("filterByLag + oldestCohort", () => {
  const now = new Date("2026-10-21T10:00:00.000Z");
  const today = zurichTodayKey(now);

  it("drops sell days inside the lag window", () => {
    const list = [
      order("#100", "2026-10-10T10:00:00.000Z"),
      order("#200", "2026-10-18T10:00:00.000Z"), // too recent for lag 5
      order("#201", "2026-10-21T08:00:00.000Z"),
    ];
    const eligible = filterByLag(list, 5, today);
    expect(eligible.map((o) => o.orderName)).toEqual(["#100"]);
  });

  it("cohort is oldest lag-eligible sell day only", () => {
    const list = [
      order("#101", "2026-10-12T08:00:00.000Z"),
      order("#102", "2026-10-12T14:00:00.000Z"),
      order("#103", "2026-10-14T10:00:00.000Z"),
      order("#104", "2026-10-20T10:00:00.000Z"),
    ];
    const plan = planBuyQueueFromOrders(list, { lagDays: 5, now });
    expect(plan.cutoffSellDateKey).toBe("2026-10-16");
    expect(plan.cohortSellDateKey).toBe("2026-10-12");
    expect(plan.orderNamesIfRunNow).toEqual(["#101", "#102"]);
    expect(plan.oldestUnlinkedOrderName).toBe("#101");
    // #104 still unlinked this month but not in run-now cohort
    expect(plan.unlinkedThisMonth).toHaveLength(4);
    expect(plan.lagEligible.map((o) => o.orderName)).toEqual([
      "#101",
      "#102",
      "#103",
    ]);
  });

  it("empty when all orders inside lag", () => {
    const list = [
      order("#301", "2026-10-18T10:00:00.000Z"),
      order("#302", "2026-10-20T10:00:00.000Z"),
    ];
    const plan = planBuyQueueFromOrders(list, { lagDays: 5, now });
    expect(plan.cohort).toEqual([]);
    expect(plan.orderNamesIfRunNow).toEqual([]);
    expect(plan.oldestUnlinkedSellDateKey).toBe("2026-10-18");
  });
});

describe("oldestCohort", () => {
  it("returns empty for empty input", () => {
    expect(oldestCohort([])).toEqual({ sellDateKey: null, orders: [] });
  });
});
