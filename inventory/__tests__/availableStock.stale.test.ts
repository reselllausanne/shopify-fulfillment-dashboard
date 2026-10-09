import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { groupBy, findMany } = vi.hoisted(() => ({
  groupBy: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    inventoryEvent: { groupBy },
    supplierVariant: { findMany },
  },
}));

import { attachAvailableStock, isScrapedStockStale, supplierStockMaxAgeDays } from "../availableStock";

const DAY = 86_400_000;

describe("isScrapedStockStale", () => {
  const now = new Date("2026-10-08T12:00:00Z");

  it("treats missing sync as stale", () => {
    expect(isScrapedStockStale(null, now, 3)).toBe(true);
  });

  it("keeps rows synced within the window", () => {
    expect(isScrapedStockStale(new Date(now.getTime() - 2.9 * DAY), now, 3)).toBe(false);
  });

  it("flags rows older than the window", () => {
    expect(isScrapedStockStale(new Date(now.getTime() - 3.1 * DAY), now, 3)).toBe(true);
  });

  it("is disabled with max age 0", () => {
    expect(isScrapedStockStale(null, now, 0)).toBe(false);
  });
});

describe("supplierStockMaxAgeDays", () => {
  const prev = process.env.SUPPLIER_STOCK_MAX_AGE_DAYS;
  afterEach(() => {
    if (prev === undefined) delete process.env.SUPPLIER_STOCK_MAX_AGE_DAYS;
    else process.env.SUPPLIER_STOCK_MAX_AGE_DAYS = prev;
  });

  it("defaults to 3 and accepts 0", () => {
    delete process.env.SUPPLIER_STOCK_MAX_AGE_DAYS;
    expect(supplierStockMaxAgeDays()).toBe(3);
    process.env.SUPPLIER_STOCK_MAX_AGE_DAYS = "0";
    expect(supplierStockMaxAgeDays()).toBe(0);
  });
});

describe("attachAvailableStock stale cutoff", () => {
  beforeEach(() => {
    groupBy.mockReset().mockResolvedValue([]);
    findMany.mockReset();
    delete process.env.SUPPLIER_STOCK_MAX_AGE_DAYS;
  });

  it("zeroes stale scraped rows, keeps fresh, manual-locked and non-scraped rows", async () => {
    const fresh = new Date(Date.now() - 1 * DAY);
    const old = new Date(Date.now() - 8 * DAY);
    findMany.mockResolvedValue([
      { supplierVariantId: "rei_fresh", lastSyncAt: fresh },
      { supplierVariantId: "rei_old", lastSyncAt: old },
      { supplierVariantId: "wel_never", lastSyncAt: null },
    ]);

    const map = await attachAvailableStock([
      { supplierVariantId: "rei_fresh", stock: 1 },
      { supplierVariantId: "rei_old", stock: 1 },
      { supplierVariantId: "wel_never", stock: 5 },
      { supplierVariantId: "rei_locked", stock: 0, manualLock: true, manualStock: 2 },
      { supplierVariantId: "stx_123", stock: 4 },
    ]);

    expect(map.get("rei_fresh")).toBe(1);
    expect(map.get("rei_old")).toBe(0);
    expect(map.get("wel_never")).toBe(0);
    expect(map.get("rei_locked")).toBe(2);
    expect(map.get("stx_123")).toBe(4);

    const queried = findMany.mock.calls.flatMap((c) => c[0].where.supplierVariantId.in);
    expect(queried).toEqual(["rei_fresh", "rei_old", "wel_never"]);
  });
});
