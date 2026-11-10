import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/app/lib/prisma", () => ({
  prisma: { channelListingState: { findMany: (...args: unknown[]) => findMany(...args) } },
}));

import {
  CLS_FULL_SCAN_THRESHOLD,
  loadGalaxusClsRowsForSupplierVariants,
} from "@/galaxus/exports/listingAlias";

const d = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n));

describe("loadGalaxusClsRowsForSupplierVariants", () => {
  beforeEach(() => findMany.mockReset());

  it("small sets use chunked IN lookups ordered by createdAt", async () => {
    findMany.mockResolvedValue([
      { supplierVariantId: "a", providerKey: "K_A", createdAt: d(1), status: "x" },
    ]);
    const rows = await loadGalaxusClsRowsForSupplierVariants(["a", "b"]);
    expect(rows).toHaveLength(1);
    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.supplierVariantId).toEqual({ in: ["a", "b"] });
    expect(arg.orderBy).toEqual({ createdAt: "asc" });
  });

  it("catalog-scale sets do a single scan, keep only wanted svIds, sorted oldest first", async () => {
    const svIds = Array.from({ length: CLS_FULL_SCAN_THRESHOLD + 1 }, (_, i) => `sv${i}`);
    findMany.mockResolvedValueOnce([
      { supplierVariantId: "sv3", providerKey: "K_NEW", createdAt: d(50), status: "ok" },
      { supplierVariantId: "other", providerKey: "K_X", createdAt: d(1), status: "ok" },
      { supplierVariantId: "sv3", providerKey: "K_OLD", createdAt: d(10), status: "ok" },
    ]);

    const rows = await loadGalaxusClsRowsForSupplierVariants(svIds);

    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ channel: "GALAXUS", archivedAt: null });
    expect(rows.map((r) => r.providerKey)).toEqual(["K_OLD", "K_NEW"]);
  });
});
