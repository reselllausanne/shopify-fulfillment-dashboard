import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

import { prisma } from "@/app/lib/prisma";
import {
  getPhysicalStockForGtin,
  loadPhysicalMirrorStockByGtinAtEveryLocation,
  loadPhysicalMirrorLocationRowsByGtin,
  loadPhysicalMirrorStockByGtin,
} from "@/shopify/inventory/physicalAvailability";

const mockedQuery = prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>;

describe("loadPhysicalMirrorStockByGtin — GTIN padding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("finds padded mirror rows when requested unpadded", async () => {
    mockedQuery.mockResolvedValue([
      {
        gtin: "0196123456789",
        qty: 2n,
        loc_id: "gid://shopify/Location/bussigny",
        loc_name: "Warehouse Bussigny",
      },
    ]);

    const map = await loadPhysicalMirrorStockByGtin(["196123456789"]);
    expect(map.get("196123456789")?.qty).toBe(2);
    expect(map.get("0196123456789")?.qty).toBe(2);
    expect(mockedQuery).toHaveBeenCalledOnce();
  });

  it("getPhysicalStockForGtin returns padded hit for unpadded input", async () => {
    mockedQuery.mockResolvedValue([
      {
        gtin: "00196123456789",
        qty: 1n,
        loc_id: "gid://shopify/Location/lab",
        loc_name: "THE LAB CONCEPT STORE",
      },
    ]);

    const row = await getPhysicalStockForGtin("196123456789");
    expect(row.qty).toBe(1);
    expect(row.preferredLocationName).toBe("THE LAB CONCEPT STORE");
  });

  it("loadPhysicalMirrorLocationRowsByGtin queries candidates", async () => {
    mockedQuery.mockResolvedValue([
      {
        shopifyVariantId: "gid://shopify/ProductVariant/1",
        inventoryItemId: "gid://shopify/InventoryItem/1",
        sku: "SKU",
        gtin: "0196123456789",
        locationId: "gid://shopify/Location/bussigny",
        locationName: "Warehouse Bussigny",
        priority: 1,
        available: 1,
      },
    ]);

    const rows = await loadPhysicalMirrorLocationRowsByGtin("196123456789");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.gtin).toBe("0196123456789");
  });

  it("returns only stock held at every required location", async () => {
    mockedQuery.mockResolvedValue([
      {
        gtin: "0196123456789",
        qty: 3n,
        loc_id: "gid://shopify/Location/bussigny",
        loc_name: "Warehouse Bussigny",
      },
    ]);

    const map = await loadPhysicalMirrorStockByGtinAtEveryLocation([
      "gid://shopify/Location/bussigny",
      "gid://shopify/Location/lab",
    ]);

    expect(map.get("0196123456789")).toMatchObject({
      qty: 3,
      preferredLocationName: "Warehouse Bussigny",
    });
    expect(mockedQuery).toHaveBeenCalledOnce();
  });
});
