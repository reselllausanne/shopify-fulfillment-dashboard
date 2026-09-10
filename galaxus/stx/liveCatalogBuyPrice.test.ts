import { describe, expect, it } from "vitest";
import {
  selectStxCatalogBuyPriceFromLanes,
  resolveLiveStxCatalogBuyPriceForMapping,
} from "@/galaxus/stx/liveCatalogBuyPrice";

describe("selectStxCatalogBuyPriceFromLanes", () => {
  it("prefers express buy for sneakers", () => {
    const price = selectStxCatalogBuyPriceFromLanes(
      {
        price: 154.99,
        stock: 1,
        deliveryType: "express_standard",
        suggestedRetailPriceInclVat: null,
        standardBuyPrice: 154.99,
        expressBuyPrice: 155.01,
        standardSuggestedRetailPriceInclVat: null,
      },
      { slug: "nike-air-zoom-pegasus-premium-washed-coral", productName: "Nike Air Zoom Pegasus Premium Washed Coral" }
    );
    expect(price).toBe(155.01);
  });
});

describe("resolveLiveStxCatalogBuyPriceForMapping", () => {
  it("computes express buy from KickDB variant prices", async () => {
    const mapping = {
      gtin: "198482777296",
      supplierVariant: {
        providerKey: "STX_198482777296",
        supplierVariantId: "stx_ced5d070-da87-4683-ac66-f01a7226b422",
        price: 154.99,
        standardBuyPrice: 154.99,
        expressBuyPrice: 384.04,
      },
      kickdbVariant: {
        kickdbVariantId: "ced5d070-da87-4683-ac66-f01a7226b422",
        sizeEu: "42.5",
        product: { urlKey: "nike-air-zoom-pegasus-premium-washed-coral", name: "Nike Air Zoom Pegasus Premium Washed Coral" },
      },
    };

    const cache = new Map<string, any>([
      [
        "nike-air-zoom-pegasus-premium-washed-coral",
        {
          title: "Nike Air Zoom Pegasus Premium Washed Coral",
          slug: "nike-air-zoom-pegasus-premium-washed-coral",
          variants: [
            {
              id: "ced5d070-da87-4683-ac66-f01a7226b422",
              identifiers: [{ identifier: "198482777296", identifier_type: "UPC" }],
              prices: [
                { price: 122, asks: 9, type: "standard" },
                { price: 122, asks: 1, type: "express_shipped" },
              ],
            },
          ],
        },
      ],
    ]);

    const price = await resolveLiveStxCatalogBuyPriceForMapping(mapping, cache);
    expect(price).toBeCloseTo(154.99, 2);
  });
});
