import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shopify/inventory/physicalAvailability", () => ({
  isPhysicalMergeEnabled: vi.fn().mockReturnValue(true),
  loadPhysicalMirrorLocationRowsByGtin: vi.fn(),
}));

vi.mock("@/shopify/restock/shopifyRestockInventory", () => ({
  findShopifyVariantByGtin: vi.fn(),
  getInventoryAvailableAtLocation: vi.fn(),
  adjustInventoryAtLocation: vi.fn(),
}));

vi.mock("@/shopify/inventory/locationMirror", () => ({
  upsertLocationStockRow: vi.fn(),
}));

vi.mock("@/shopify/inventory/convergence", () => ({
  convergeVariant: vi.fn(),
}));

vi.mock("@/shopify/inventory/locationConfig", () => ({
  getLocationConfig: vi.fn(),
}));

import { loadPhysicalMirrorLocationRowsByGtin } from "@/shopify/inventory/physicalAvailability";
import { convergeVariant } from "@/shopify/inventory/convergence";
import { getLocationConfig } from "@/shopify/inventory/locationConfig";
import { upsertLocationStockRow } from "@/shopify/inventory/locationMirror";
import {
  adjustInventoryAtLocation,
  findShopifyVariantByGtin,
  getInventoryAvailableAtLocation,
} from "@/shopify/restock/shopifyRestockInventory";
import { routeMarketplacePhysicalSale } from "@/shopify/inventory/marketplacePhysicalSale";

const mockedMirrorRows = loadPhysicalMirrorLocationRowsByGtin as unknown as ReturnType<typeof vi.fn>;
const mockedFindVariant = findShopifyVariantByGtin as unknown as ReturnType<typeof vi.fn>;
const mockedGetQty = getInventoryAvailableAtLocation as unknown as ReturnType<typeof vi.fn>;
const mockedAdjust = adjustInventoryAtLocation as unknown as ReturnType<typeof vi.fn>;
const mockedUpsertMirror = upsertLocationStockRow as unknown as ReturnType<typeof vi.fn>;
const mockedConverge = convergeVariant as unknown as ReturnType<typeof vi.fn>;
const mockedLocCfg = getLocationConfig as unknown as ReturnType<typeof vi.fn>;

describe("routeMarketplacePhysicalSale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MARKETPLACE_PHYSICAL_SALE_ROUTING = "1";
  });

  it("skips when no physical mirror stock", async () => {
    mockedMirrorRows.mockResolvedValue([]);

    const result = await routeMarketplacePhysicalSale({
      channel: "GALAXUS",
      externalLineId: "GALAXUS:1:1",
      gtin: "196479477181",
      quantity: 1,
    });

    expect(result.routed).toBe(false);
    expect(result.skipReason).toBe("no_physical");
    expect(mockedAdjust).not.toHaveBeenCalled();
  });

  it("decrements at priority location and converges", async () => {
    mockedMirrorRows.mockResolvedValue([
      {
        shopifyVariantId: "gid://shopify/ProductVariant/1",
        inventoryItemId: "gid://shopify/InventoryItem/1",
        sku: "JH8654-39 1/3",
        gtin: "196479477181",
        locationId: "gid://shopify/Location/111267971458",
        locationName: "Warehouse Bussigny",
        priority: 1,
        available: 1,
      },
    ]);
    mockedFindVariant.mockResolvedValue({
      match: {
        variantId: "gid://shopify/ProductVariant/1",
        inventoryItemId: "gid://shopify/InventoryItem/1",
        sku: "JH8654-39 1/3",
      },
      ambiguous: false,
      rawMatches: [],
    });
    mockedGetQty.mockResolvedValue(1);
    mockedLocCfg.mockReturnValue({
      id: "gid://shopify/Location/111267971458",
      name: "Warehouse Bussigny",
      sourceType: "physical",
      priority: 1,
    });
    mockedConverge.mockResolvedValue({
      gtin: "196479477181",
      physicalQty: 0,
      desired: "dropship",
      changed: true,
      changes: ["unlocked"],
      warnings: [],
    });

    const result = await routeMarketplacePhysicalSale({
      channel: "DECATHLON",
      externalLineId: "DECATHLON:ORD-1:LINE-1",
      gtin: "196479477181",
      quantity: 1,
    });

    expect(result.routed).toBe(true);
    expect(result.decremented).toBe(1);
    expect(mockedAdjust).toHaveBeenCalledWith(
      expect.objectContaining({
        delta: -1,
        reason: "correction",
        idempotencyKey: "marketplace-sale:DECATHLON:DECATHLON:ORD-1:LINE-1:gid://shopify/Location/111267971458",
      })
    );
    expect(mockedUpsertMirror).toHaveBeenCalled();
    expect(mockedConverge).toHaveBeenCalledWith("196479477181");
  });
});
