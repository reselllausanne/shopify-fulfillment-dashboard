import { beforeEach, describe, expect, it, vi } from "vitest";
import { processShopifyPaidPhysicalSale } from "@/shopify/localStock/processShopifyPaidPhysicalSale";

vi.mock("@/shopify/inventory/physicalAvailability", () => ({
  loadPhysicalMirrorLocationRowsByGtin: vi.fn(),
}));

vi.mock("@/shopify/localStock/consumeFromLocalStock", () => ({
  tryConsumeLocalStockLot: vi.fn(),
}));

vi.mock("@/shopify/localStock/applyLocalStockSaleSideEffects", () => ({
  applyLocalStockSaleSideEffects: vi.fn().mockResolvedValue({
    applied: true,
    gtin: "195021206798",
    inventoryDecremented: true,
    mirrorUpdated: true,
    warnings: [],
  }),
}));

vi.mock("@/shopify/orders/postSaleRefresh", () => ({
  refreshAfterShopifySale: vi.fn().mockResolvedValue({ gtin: "195021206798", warnings: [] }),
}));

vi.mock("@/shopify/restock/shopifyRestockInventory", () => ({
  findShopifyVariantByGtin: vi.fn().mockResolvedValue({
    match: {
      variantId: "gid://shopify/ProductVariant/1",
      inventoryItemId: "gid://shopify/InventoryItem/1",
      sku: "SKU-1",
    },
  }),
  getShopifyVariantDetail: vi.fn(),
}));

vi.mock("@/inventory/postSaleMarketplacePricePush", () => ({
  schedulePostSaleMarketplacePricePush: vi.fn(),
}));

import { loadPhysicalMirrorLocationRowsByGtin } from "@/shopify/inventory/physicalAvailability";
import { tryConsumeLocalStockLot } from "@/shopify/localStock/consumeFromLocalStock";
import { applyLocalStockSaleSideEffects } from "@/shopify/localStock/applyLocalStockSaleSideEffects";
import { refreshAfterShopifySale } from "@/shopify/orders/postSaleRefresh";

describe("processShopifyPaidPhysicalSale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("consumes lot + side effects when OPEN lot exists", async () => {
    vi.mocked(loadPhysicalMirrorLocationRowsByGtin).mockResolvedValue([
      {
        locationId: "loc-lab",
        locationName: "THE LAB",
        available: 1,
        priority: 3,
      },
    ]);
    vi.mocked(tryConsumeLocalStockLot).mockResolvedValue({
      lotId: "lot-1",
      shopifyVariantId: "gid://shopify/ProductVariant/1",
      inventoryItemId: "gid://shopify/InventoryItem/1",
      sku: "SKU-1",
      gtin: "195021206798",
      unitCostChf: 0,
      costBasis: "ALREADY_EXPENSED",
      origin: "CUSTOMER_RETURN",
      locationId: "loc-lab",
      locationName: "THE LAB",
      sourceOrderMatchId: null,
      supplierCost: 0,
      manualCostOverride: 0,
      marginAmount: 129,
      marginPercent: 100,
      manualNote: "",
      stockxStatus: "LOCAL_STOCK",
      supplierSource: "LOCAL",
    });

    const result = await processShopifyPaidPhysicalSale({
      gtin: "195021206798",
      sku: "SKU-1",
      variantId: "gid://shopify/ProductVariant/1",
      lineItemId: "12345",
      revenue: 129,
    });

    expect(result.isPhysicalStoreSale).toBe(true);
    expect(result.lotConsumed).toBe(true);
    expect(result.refreshAlreadyRan).toBe(true);
    expect(applyLocalStockSaleSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        shopifyLineItemId: "gid://shopify/LineItem/12345",
      })
    );
    expect(refreshAfterShopifySale).not.toHaveBeenCalled();
  });

  it("zeros stale mirror + refresh when physical mirror qty without lot", async () => {
    vi.mocked(loadPhysicalMirrorLocationRowsByGtin).mockResolvedValue([
      {
        locationId: "loc-lab",
        locationName: "THE LAB",
        available: 1,
        priority: 3,
      },
    ]);
    vi.mocked(tryConsumeLocalStockLot).mockResolvedValue(null);

    const result = await processShopifyPaidPhysicalSale({
      gtin: "195021206798",
      sku: "SKU-1",
      variantId: "gid://shopify/ProductVariant/1",
      lineItemId: "999",
      revenue: 129,
    });

    expect(result.isPhysicalStoreSale).toBe(true);
    expect(result.lotConsumed).toBe(false);
    expect(result.refreshAlreadyRan).toBe(true);
    expect(applyLocalStockSaleSideEffects).not.toHaveBeenCalled();
    expect(refreshAfterShopifySale).toHaveBeenCalledWith(
      "195021206798",
      expect.objectContaining({ skipDropshipRelist: true, skipInventoryDecrement: true })
    );
  });

  it("passes through dropship when no physical mirror", async () => {
    vi.mocked(loadPhysicalMirrorLocationRowsByGtin).mockResolvedValue([]);
    vi.mocked(tryConsumeLocalStockLot).mockResolvedValue(null);

    const result = await processShopifyPaidPhysicalSale({
      gtin: "195021206798",
      sku: "SKU-DROP",
      variantId: "gid://shopify/ProductVariant/2",
    });

    expect(result.isPhysicalStoreSale).toBe(false);
    expect(result.refreshAlreadyRan).toBe(false);
  });
});
