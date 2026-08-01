import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shopify/catalog/graphql", () => ({
  findVariantBySku: vi.fn(),
}));

vi.mock("@/shopify/inventory/locationConfig", () => ({
  getLocationConfig: vi.fn(),
}));

vi.mock("@/shopify/inventory/locationMirror", () => ({
  upsertLocationStockRow: vi.fn(),
}));

vi.mock("@/shopify/orders/postSaleRefresh", () => ({
  refreshAfterShopifySale: vi.fn().mockResolvedValue({ gtin: "195021206798", warnings: [] }),
}));

vi.mock("@/inventory/postSaleMarketplacePricePush", () => ({
  schedulePostSaleMarketplacePricePush: vi.fn(),
}));

vi.mock("@/shopify/restock/shopifyRestockInventory", () => ({
  adjustInventoryAtLocation: vi.fn(),
  getInventoryAvailableAtLocation: vi.fn(),
  getShopifyVariantDetail: vi.fn(),
}));

import { schedulePostSaleMarketplacePricePush } from "@/inventory/postSaleMarketplacePricePush";
import { getLocationConfig } from "@/shopify/inventory/locationConfig";
import { upsertLocationStockRow } from "@/shopify/inventory/locationMirror";
import { refreshAfterShopifySale } from "@/shopify/orders/postSaleRefresh";
import { applyLocalStockSaleSideEffects } from "@/shopify/localStock/applyLocalStockSaleSideEffects";
import {
  adjustInventoryAtLocation,
  getInventoryAvailableAtLocation,
  getShopifyVariantDetail,
} from "@/shopify/restock/shopifyRestockInventory";

const mockedGetQty = getInventoryAvailableAtLocation as unknown as ReturnType<typeof vi.fn>;
const mockedAdjust = adjustInventoryAtLocation as unknown as ReturnType<typeof vi.fn>;
const mockedUpsert = upsertLocationStockRow as unknown as ReturnType<typeof vi.fn>;
const mockedRefresh = refreshAfterShopifySale as unknown as ReturnType<typeof vi.fn>;
const mockedPricePush = schedulePostSaleMarketplacePricePush as unknown as ReturnType<
  typeof vi.fn
>;
const mockedLocCfg = getLocationConfig as unknown as ReturnType<typeof vi.fn>;
const mockedVariantDetail = getShopifyVariantDetail as unknown as ReturnType<typeof vi.fn>;

const consumedBase = {
  lotId: "lot-1",
  shopifyVariantId: "gid://shopify/ProductVariant/1",
  inventoryItemId: "gid://shopify/InventoryItem/1",
  sku: "S70739-30-43",
  gtin: "195021206798",
  unitCostChf: 80,
  costBasis: "UNIT_COST",
  origin: "CUSTOMER_RETURN",
  locationId: "gid://shopify/Location/lab",
  locationName: "THE LAB CONCEPT STORE",
  sourceOrderMatchId: null,
  supplierCost: 80,
  manualCostOverride: null,
  marginAmount: 119,
  marginPercent: 59.8,
  manualNote: "Local stock lot lot-1",
  stockxStatus: "LOCAL_STOCK" as const,
  supplierSource: "LOCAL" as const,
};

describe("applyLocalStockSaleSideEffects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetQty.mockResolvedValueOnce(1).mockResolvedValue(0);
    mockedLocCfg.mockReturnValue({
      id: consumedBase.locationId,
      name: consumedBase.locationName,
      sourceType: "physical",
      priority: 3,
    });
  });

  it("decrements Shopify, mirrors qty 0, and runs post-sale refresh", async () => {
    const result = await applyLocalStockSaleSideEffects({
      consumed: consumedBase,
      shopifyLineItemId: "line-6514",
    });

    expect(result.applied).toBe(true);
    expect(result.inventoryDecremented).toBe(true);
    expect(result.mirrorUpdated).toBe(true);
    expect(result.gtin).toBe("195021206798");

    expect(mockedAdjust).toHaveBeenCalledWith(
      expect.objectContaining({
        inventoryItemId: consumedBase.inventoryItemId,
        locationId: consumedBase.locationId,
        delta: -1,
        idempotencyKey: "local-stock-sale:line-6514:gid://shopify/Location/lab",
      })
    );
    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        shopifyVariantId: consumedBase.shopifyVariantId,
        available: 0,
        gtin: "195021206798",
      })
    );
    expect(mockedRefresh).toHaveBeenCalledWith("195021206798", {
      forceMarketPrice: true,
      skipInventoryDecrement: true,
      skipDropshipRelist: true,
      variantId: consumedBase.shopifyVariantId,
      lineItemId: "line-6514",
      soldQty: 1,
    });
    expect(mockedPricePush).toHaveBeenCalled();
    expect(mockedVariantDetail).not.toHaveBeenCalled();
  });

  it("resolves gtin from variant barcode when lot gtin is missing", async () => {
    mockedGetQty.mockReset();
    mockedGetQty.mockResolvedValueOnce(1).mockResolvedValue(0);
    mockedVariantDetail.mockResolvedValue({ barcode: "195021206798" });

    await applyLocalStockSaleSideEffects({
      consumed: { ...consumedBase, gtin: null },
      shopifyLineItemId: "line-6514",
    });

    expect(mockedVariantDetail).toHaveBeenCalledWith(consumedBase.shopifyVariantId);
    expect(mockedRefresh).toHaveBeenCalledWith(
      "195021206798",
      expect.objectContaining({ forceMarketPrice: true })
    );
  });

  it("skips shopify decrement when location already at 0 but still mirrors 0 and refreshes pricing", async () => {
    mockedGetQty.mockReset();
    mockedGetQty.mockResolvedValue(0);

    const result = await applyLocalStockSaleSideEffects({
      consumed: consumedBase,
      shopifyLineItemId: "line-6514",
    });

    expect(mockedAdjust).not.toHaveBeenCalled();
    expect(result.inventoryDecremented).toBe(false);
    expect(result.mirrorUpdated).toBe(true);
    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ available: 0 })
    );
    expect(mockedRefresh).toHaveBeenCalled();
  });
});
