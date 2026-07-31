import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  orderMatch: {
    findMany: vi.fn(),
  },
  localStockLot: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("@/app/lib/prisma", () => ({
  prisma: prismaMock,
}));

vi.mock("@/shopify/catalog/graphql", () => ({
  findVariantBySku: vi.fn(),
}));

vi.mock("@/shopify/inventory/locationConfig", () => ({
  LOCATIONS: [
    {
      id: "gid://shopify/Location/111267971458",
      name: "Warehouse Bussigny",
      sourceType: "physical",
      priority: 1,
    },
  ],
}));

import { findVariantBySku } from "@/shopify/catalog/graphql";
import { intakeLocalStockLotsFromReturnReceipt } from "@/shopify/localStock/intakeFromReturnReceipt";

const mockedFindVariant = findVariantBySku as unknown as ReturnType<typeof vi.fn>;

describe("intakeLocalStockLotsFromReturnReceipt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates one CUSTOMER_RETURN lot for a restocked returned match", async () => {
    prismaMock.orderMatch.findMany.mockResolvedValue([
      {
        id: "match-1",
        shopifySku: "TEE-001-M",
        shopifySizeEU: "M",
        shopifyProductTitle: "Tee",
        returnedStockValueChf: 42,
      },
    ]);
    prismaMock.localStockLot.findUnique.mockResolvedValue(null);
    prismaMock.localStockLot.create.mockResolvedValue({ id: "lot-1" });
    mockedFindVariant.mockResolvedValue({
      variantId: "gid://shopify/ProductVariant/200",
      productId: "gid://shopify/Product/100",
      inventoryItemId: "gid://shopify/InventoryItem/300",
    });

    const result = await intakeLocalStockLotsFromReturnReceipt({
      marketplaceReturnId: "mr-1",
      updatedMatchIds: ["match-1"],
      restockLines: [{ sku: "TEE-001-M", status: "restocked" }],
      now: new Date("2026-07-31T10:00:00.000Z"),
    });

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.lotIds).toEqual(["lot-1"]);
    expect(prismaMock.localStockLot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          origin: "CUSTOMER_RETURN",
          costBasis: "ALREADY_EXPENSED",
          unitCostChf: 0,
          qtyInitial: 1,
          qtyAvailable: 1,
          sourceOrderMatchId: "match-1",
          sourceMarketplaceReturnId: "mr-1",
          migrationKey: "returnMatch:match-1",
        }),
      })
    );
  });

  it("is idempotent when lot already exists by migrationKey", async () => {
    prismaMock.orderMatch.findMany.mockResolvedValue([
      {
        id: "match-1",
        shopifySku: "TEE-001-M",
        shopifySizeEU: "M",
        shopifyProductTitle: "Tee",
        returnedStockValueChf: 0,
      },
    ]);
    prismaMock.localStockLot.findUnique.mockResolvedValue({ id: "lot-existing" });

    const result = await intakeLocalStockLotsFromReturnReceipt({
      marketplaceReturnId: "mr-1",
      updatedMatchIds: ["match-1"],
      restockLines: [{ sku: "TEE-001-M", status: "restocked" }],
    });

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.lotIds).toEqual(["lot-existing"]);
    expect(prismaMock.localStockLot.create).not.toHaveBeenCalled();
  });

  it("skips when SKU was not successfully restocked", async () => {
    prismaMock.orderMatch.findMany.mockResolvedValue([
      {
        id: "match-1",
        shopifySku: "TEE-001-M",
        shopifySizeEU: "M",
        shopifyProductTitle: "Tee",
        returnedStockValueChf: 0,
      },
    ]);

    const result = await intakeLocalStockLotsFromReturnReceipt({
      marketplaceReturnId: "mr-1",
      updatedMatchIds: ["match-1"],
      restockLines: [{ sku: "TEE-001-M", status: "error" }],
    });

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(prismaMock.localStockLot.create).not.toHaveBeenCalled();
  });
});
