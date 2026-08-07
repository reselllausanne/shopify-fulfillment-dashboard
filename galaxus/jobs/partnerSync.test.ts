import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/galaxus/jobs/bulkSql", () => ({
  remapRowsToExistingProviderKeyGtin: vi.fn(async (rows: unknown[]) => ({
    rows: rows as Array<{ supplierVariantId: string; providerKey: string; gtin: string }>,
  })),
  chunkArray: <T,>(items: T[]) => (items.length ? [items] : []),
  bulkInsertSupplierVariantsByProviderKeyGtin: vi.fn(async () => 0),
  bulkUpdateSupplierVariantsByProviderKeyGtin: vi.fn(async () => 0),
  bulkUpsertVariantMappings: vi.fn(async () => ({ inserted: 0, updated: 0 })),
}));

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    partnerUploadRow: { findMany: mocks.findMany },
    supplierVariant: { updateMany: vi.fn(), deleteMany: vi.fn() },
    $queryRaw: mocks.queryRaw,
  },
}));

import { runPartnerSync } from "./partnerSync";

describe("runPartnerSync", () => {
  beforeEach(() => {
    mocks.findMany.mockReset();
    mocks.queryRaw.mockReset();
    delete process.env.THE_SUPPLIER_ENABLED;
  });

  afterEach(() => {
    delete process.env.THE_SUPPLIER_ENABLED;
  });

  it("skips explicit THE partner sync when THE supplier is disabled", async () => {
    const result = await runPartnerSync({ partnerKey: "THE" });
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(result.scanned).toBe(0);
    expect(result.processed).toBe(0);
  });

  it("does not upsert THE upload rows when syncing all partners", async () => {
    mocks.findMany.mockResolvedValue([
      {
        providerKey: "THE",
        gtinResolved: "7612345678901",
        sku: "IM4002-100",
        sizeNormalized: "40",
        sizeRaw: "40",
        rawStock: 2,
        price: 100,
        updatedAt: new Date(),
      },
      {
        providerKey: "NER",
        gtinResolved: "7612345678902",
        sku: "IM4002-101",
        sizeNormalized: "41",
        sizeRaw: "41",
        rawStock: 0,
        price: 100,
        updatedAt: new Date(),
      },
    ]);
    mocks.queryRaw.mockResolvedValue([]);

    const result = await runPartnerSync({ limit: 10 });
    expect(result.scanned).toBe(2);
    expect(result.skippedInvalid).toBe(1);
    expect(result.processed).toBe(0);
  });
});
