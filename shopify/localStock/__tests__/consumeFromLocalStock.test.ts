import { beforeEach, describe, expect, it, vi } from "vitest";

const txMock = vi.hoisted(() => ({
  localStockLot: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  orderMatch: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock)),
}));

vi.mock("@/app/lib/prisma", () => ({
  prisma: prismaMock,
}));

import { tryConsumeLocalStockLot } from "@/shopify/localStock/consumeFromLocalStock";

describe("tryConsumeLocalStockLot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("consumes FIFO open lot and returns LOCAL cost snapshot", async () => {
    txMock.localStockLot.findFirst.mockResolvedValue({
      id: "lot-1",
      sku: "IH6766-001-39",
      qtyAvailable: 1,
      status: "OPEN",
    });
    txMock.localStockLot.updateMany.mockResolvedValue({ count: 1 });
    txMock.localStockLot.findUnique.mockResolvedValue({
      id: "lot-1",
      shopifyVariantId: "gid://shopify/ProductVariant/1",
      inventoryItemId: "gid://shopify/InventoryItem/1",
      gtin: "195021206798",
      unitCostChf: 120,
      costBasis: "ALREADY_EXPENSED",
      origin: "CUSTOMER_RETURN",
      locationId: "gid://shopify/Location/bussigny",
      locationName: "Warehouse Bussigny",
      sourceOrderMatchId: "match-source",
      qtyAvailable: 0,
      sku: "IH6766-001-39",
    });
    txMock.localStockLot.update.mockResolvedValue({});
    txMock.orderMatch.findUnique.mockResolvedValue({
      id: "match-source",
      manualNote: null,
      returnedStockValueChf: 120,
      shopifyOrderName: "#1001",
    });
    txMock.orderMatch.update.mockResolvedValue({});

    const result = await tryConsumeLocalStockLot({
      shopifySku: "IH6766-001-39",
      revenue: 199,
    });

    expect(result).toMatchObject({
      lotId: "lot-1",
      shopifyVariantId: "gid://shopify/ProductVariant/1",
      inventoryItemId: "gid://shopify/InventoryItem/1",
      gtin: "195021206798",
      supplierSource: "LOCAL",
      stockxStatus: "LOCAL_STOCK",
      unitCostChf: 120,
      supplierCost: 0,
      marginAmount: 199,
      sourceOrderMatchId: "match-source",
    });
    expect(txMock.localStockLot.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "lot-1", qtyAvailable: { gte: 1 }, status: "OPEN" },
        data: expect.objectContaining({
          qtyAvailable: { decrement: 1 },
          qtySold: { increment: 1 },
        }),
      })
    );
    expect(txMock.localStockLot.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "lot-1" },
        data: expect.objectContaining({ status: "DEPLETED" }),
      })
    );
    expect(txMock.orderMatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "match-source" },
        data: expect.objectContaining({ returnedStockValueChf: 0 }),
      })
    );
  });

  it("returns null when no open lot", async () => {
    txMock.localStockLot.findFirst.mockResolvedValue(null);

    const result = await tryConsumeLocalStockLot({
      shopifySku: "MISSING-SKU",
      revenue: 100,
    });

    expect(result).toBeNull();
    expect(txMock.localStockLot.updateMany).not.toHaveBeenCalled();
  });

  it("returns null on race when updateMany affects 0 rows", async () => {
    txMock.localStockLot.findFirst.mockResolvedValue({
      id: "lot-1",
      sku: "IH6766-001-39",
      qtyAvailable: 1,
      status: "OPEN",
    });
    txMock.localStockLot.updateMany.mockResolvedValue({ count: 0 });

    const result = await tryConsumeLocalStockLot({
      shopifySku: "IH6766-001-39",
      revenue: 100,
    });

    expect(result).toBeNull();
  });
});
