import { beforeEach, describe, expect, it, vi } from "vitest";

const executeRaw = vi.fn(async (..._args: unknown[]) => 0);
const findMany = vi.fn();
const attachAvailableStock = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
    variantMapping: { findMany: (...args: unknown[]) => findMany(...args) },
  },
}));
vi.mock("@/inventory/availableStock", () => ({
  attachAvailableStock: (...args: unknown[]) => attachAvailableStock(...args),
}));
vi.mock("./availableStock", () => ({
  attachAvailableStock: (...args: unknown[]) => attachAvailableStock(...args),
}));
vi.mock("@/decathlon/exports/catalogPolicy", () => ({
  isDecathlonSalesPaused: () => true,
}));

import {
  LISTING_SNAPSHOT_UPSERT_CHUNK,
  refreshChannelListingSnapshots,
  upsertChannelListingChunk,
} from "@/inventory/listingSnapshot";

function mapping(i: number) {
  return {
    providerKey: `NER_${i}`,
    gtin: i % 2 === 0 ? `gtin${i}` : null,
    supplierVariantId: `ner:${i}`,
    supplierVariant: { supplierVariantId: `ner:${i}`, stock: 3, manualStock: null, manualLock: false },
  };
}

describe("refreshChannelListingSnapshots (set-based upsert)", () => {
  beforeEach(() => {
    executeRaw.mockReset();
    executeRaw.mockImplementation(async () => 1);
    findMany.mockReset();
    attachAvailableStock.mockReset();
  });

  it("issues one statement per chunk and channel instead of one upsert per row", async () => {
    const total = LISTING_SNAPSHOT_UPSERT_CHUNK * 2 + 5;
    findMany.mockResolvedValue(Array.from({ length: total }, (_, i) => mapping(i)));
    attachAvailableStock.mockResolvedValue(new Map());

    const res = await refreshChannelListingSnapshots(["GALAXUS", "DECATHLON"]);

    expect(res.scanned).toBe(total);
    // 3 chunks × 2 channels
    expect(executeRaw).toHaveBeenCalledTimes(6);
    expect(res.upserted).toBe(6);
  });

  it("dedupes provider keys and skips rows without supplierVariantId", async () => {
    findMany.mockResolvedValue([
      mapping(1),
      mapping(1),
      { ...mapping(2), supplierVariantId: "" },
      mapping(3),
    ]);
    attachAvailableStock.mockResolvedValue(new Map());

    const res = await refreshChannelListingSnapshots(["GALAXUS"]);
    expect(res.scanned).toBe(3); // NER_1, NER_2, NER_3 after dedupe
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const sql = executeRaw.mock.calls[0][0] as { values: unknown[] };
    const arrays = sql.values.filter(Array.isArray) as unknown[][];
    // providerKeys array carries only the 2 valid rows (NER_1, NER_3)
    expect(arrays[0]).toEqual(["NER_1", "NER_3"]);
  });

  it("forces stock 0 for DECATHLON while sales are paused, real stock for GALAXUS", async () => {
    await upsertChannelListingChunk(
      "DECATHLON",
      [{ providerKey: "NER_1", supplierVariantId: "ner:1", gtin: null, stock: 7 }],
      new Date("2026-11-10T12:00:00Z")
    );
    await upsertChannelListingChunk(
      "GALAXUS",
      [{ providerKey: "NER_1", supplierVariantId: "ner:1", gtin: null, stock: 7 }],
      new Date("2026-11-10T12:00:00Z")
    );
    const stocksOf = (callIdx: number) => {
      const sql = executeRaw.mock.calls[callIdx][0] as { values: unknown[] };
      const arrays = sql.values.filter(Array.isArray) as unknown[][];
      return arrays[3];
    };
    expect(stocksOf(0)).toEqual([0]);
    expect(stocksOf(1)).toEqual([7]);
  });
});
