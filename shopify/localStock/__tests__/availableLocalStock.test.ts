import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAvailableLocalStockLotsBySku,
  normalizeLocalStockSkus,
} from "@/shopify/localStock/availableLocalStock";

const prismaMock = {
  localStockLot: {
    findMany: vi.fn(),
  },
};

describe("available local stock lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes SKU input", () => {
    expect(normalizeLocalStockSkus([" A ", "", null, "A", "B"])).toEqual(["A", "B"]);
    expect(normalizeLocalStockSkus("A")).toEqual([]);
  });

  it("returns one FIFO lot per SKU in request order", async () => {
    prismaMock.localStockLot.findMany.mockResolvedValue([
      {
        id: "lot-b",
        sku: "SKU-B",
        qtyAvailable: 2,
        unitCostChf: 80,
        costBasis: "ACQUISITION",
        origin: "CUSTOMER_RETURN",
        locationId: "loc-1",
        locationName: "Bussigny",
        enteredAt: new Date("2026-07-01T00:00:00Z"),
      },
      {
        id: "lot-a",
        sku: "SKU-A",
        qtyAvailable: 1,
        unitCostChf: 0,
        costBasis: "ALREADY_EXPENSED",
        origin: "ESSENTIALS",
        locationId: "loc-2",
        locationName: "THE LAB",
        enteredAt: new Date("2026-07-02T00:00:00Z"),
      },
      {
        id: "lot-a-newer",
        sku: "SKU-A",
        qtyAvailable: 1,
        unitCostChf: 90,
        costBasis: "ACQUISITION",
        origin: "OTHER",
        locationId: "loc-3",
        locationName: "Antica",
        enteredAt: new Date("2026-07-03T00:00:00Z"),
      },
    ]);

    const rows = await getAvailableLocalStockLotsBySku(["SKU-A", "SKU-B"], prismaMock);

    expect(prismaMock.localStockLot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sku: { in: ["SKU-A", "SKU-B"] },
          status: "OPEN",
          qtyAvailable: { gt: 0 },
        },
        orderBy: [{ enteredAt: "asc" }, { createdAt: "asc" }],
      })
    );
    expect(rows.map((row) => row.lotId)).toEqual(["lot-a", "lot-b"]);
    expect(rows[0]).toMatchObject({
      sku: "SKU-A",
      unitCostChf: 0,
      costBasis: "ALREADY_EXPENSED",
      origin: "ESSENTIALS",
      locationName: "THE LAB",
    });
  });

  it("skips DB query when no SKUs", async () => {
    const rows = await getAvailableLocalStockLotsBySku([], prismaMock);

    expect(rows).toEqual([]);
    expect(prismaMock.localStockLot.findMany).not.toHaveBeenCalled();
  });
});
