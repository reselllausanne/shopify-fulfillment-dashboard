import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { groupBy, findMany, eventFindMany } = vi.hoisted(() => ({
  groupBy: vi.fn(),
  findMany: vi.fn(),
  eventFindMany: vi.fn(),
}));

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    inventoryEvent: { groupBy, findMany: eventFindMany },
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

  it("defaults to 2 and accepts 0", () => {
    delete process.env.SUPPLIER_STOCK_MAX_AGE_DAYS;
    expect(supplierStockMaxAgeDays()).toBe(2);
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

describe("attachAvailableStock ledger for scraped suppliers", () => {
  beforeEach(() => {
    groupBy.mockReset();
    findMany.mockReset();
    eventFindMany.mockReset();
    delete process.env.SUPPLIER_STOCK_MAX_AGE_DAYS;
  });

  it("ignores sales booked before the last scrape, keeps later ones", async () => {
    const lastScrape = new Date(Date.now() - 3_600_000);
    groupBy.mockResolvedValue([
      { supplierVariantId: "rei_sold_before", _sum: { quantityDelta: -1 } },
      { supplierVariantId: "rei_sold_after", _sum: { quantityDelta: -1 } },
      { supplierVariantId: "stx_1", _sum: { quantityDelta: -1 } },
    ]);
    findMany.mockResolvedValue([
      { supplierVariantId: "rei_sold_before", lastSyncAt: lastScrape },
      { supplierVariantId: "rei_sold_after", lastSyncAt: lastScrape },
    ]);
    eventFindMany.mockResolvedValue([
      { supplierVariantId: "rei_sold_before", quantityDelta: -1, createdAt: new Date(Date.now() - 2 * DAY) },
      { supplierVariantId: "rei_sold_after", quantityDelta: -1, createdAt: new Date() },
      { supplierVariantId: "stx_1", quantityDelta: -1, createdAt: new Date() },
    ]);

    const map = await attachAvailableStock([
      { supplierVariantId: "rei_sold_before", stock: 1 },
      { supplierVariantId: "rei_sold_after", stock: 1 },
      { supplierVariantId: "stx_1", stock: 2 },
    ]);

    expect(map.get("rei_sold_before")).toBe(1);
    expect(map.get("rei_sold_after")).toBe(0);
    expect(map.get("stx_1")).toBe(1);
  });
});

describe("attachAvailableStock ledger window for feed suppliers", () => {
  const prev = process.env.SUPPLIER_LEDGER_WINDOW_HOURS;
  beforeEach(() => {
    groupBy.mockReset();
    findMany.mockReset().mockResolvedValue([]);
    eventFindMany.mockReset();
    delete process.env.SUPPLIER_STOCK_MAX_AGE_DAYS;
    delete process.env.SUPPLIER_LEDGER_WINDOW_HOURS;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.SUPPLIER_LEDGER_WINDOW_HOURS;
    else process.env.SUPPLIER_LEDGER_WINDOW_HOURS = prev;
  });

  it("drops NER/STX sales older than the window, keeps recent ones and own stock", async () => {
    groupBy.mockResolvedValue([
      { supplierVariantId: "ner:OLD-42", _sum: { quantityDelta: -1 } },
      { supplierVariantId: "ner:NEW-42", _sum: { quantityDelta: -1 } },
      { supplierVariantId: "stx_old", _sum: { quantityDelta: -2 } },
      { supplierVariantId: "golden_1", _sum: { quantityDelta: -1 } },
    ]);
    eventFindMany.mockResolvedValue([
      { supplierVariantId: "ner:OLD-42", quantityDelta: -1, createdAt: new Date(Date.now() - 5 * DAY) },
      { supplierVariantId: "ner:NEW-42", quantityDelta: -1, createdAt: new Date(Date.now() - 3_600_000) },
      { supplierVariantId: "stx_old", quantityDelta: -2, createdAt: new Date(Date.now() - 3 * DAY) },
    ]);

    const map = await attachAvailableStock([
      { supplierVariantId: "ner:OLD-42", stock: 1 },
      { supplierVariantId: "ner:NEW-42", stock: 1 },
      { supplierVariantId: "stx_old", stock: 2 },
      { supplierVariantId: "golden_1", stock: 1 },
    ]);

    expect(map.get("ner:OLD-42")).toBe(1);
    expect(map.get("ner:NEW-42")).toBe(0);
    expect(map.get("stx_old")).toBe(2);
    expect(map.get("golden_1")).toBe(0);
  });

  it("applies the full ledger when the window is 0", async () => {
    process.env.SUPPLIER_LEDGER_WINDOW_HOURS = "0";
    groupBy.mockResolvedValue([{ supplierVariantId: "ner:OLD-42", _sum: { quantityDelta: -1 } }]);

    const map = await attachAvailableStock([{ supplierVariantId: "ner:OLD-42", stock: 1 }]);

    expect(map.get("ner:OLD-42")).toBe(0);
    expect(eventFindMany).not.toHaveBeenCalled();
  });
});
