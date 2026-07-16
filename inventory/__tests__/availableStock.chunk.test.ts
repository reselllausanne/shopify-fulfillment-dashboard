import { beforeEach, describe, expect, it, vi } from "vitest";

const { groupBy } = vi.hoisted(() => ({
  groupBy: vi.fn(),
}));

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    inventoryEvent: {
      groupBy,
    },
  },
}));

import { loadInventoryDeltasBySupplierVariantId } from "../availableStock";

describe("loadInventoryDeltasBySupplierVariantId", () => {
  beforeEach(() => {
    groupBy.mockReset();
    groupBy.mockResolvedValue([]);
  });

  it("chunks large id lists under postgres bind limit", async () => {
    const ids = Array.from({ length: 12_000 }, (_, i) => `stx_${i}`);
    await loadInventoryDeltasBySupplierVariantId(ids);
    expect(groupBy).toHaveBeenCalledTimes(3);
    expect(groupBy.mock.calls[0][0].where.supplierVariantId.in).toHaveLength(5000);
    expect(groupBy.mock.calls[1][0].where.supplierVariantId.in).toHaveLength(5000);
    expect(groupBy.mock.calls[2][0].where.supplierVariantId.in).toHaveLength(2000);
  });
});
