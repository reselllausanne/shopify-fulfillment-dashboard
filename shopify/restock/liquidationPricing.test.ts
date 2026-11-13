import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    supplierVariant: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("@/lib/shopifyAdmin", () => ({
  shopifyGraphQL: vi.fn(),
}));

vi.mock("@/shopify/restock/physicalRestockPricing", () => ({
  resolvePhysicalRestockPricing: vi.fn(),
}));

vi.mock("@/shopify/restock/shopifyRestockInventory", () => ({
  applyVariantSalePrice: vi.fn().mockResolvedValue(undefined),
  getShopifyVariantDetail: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/shopify/restock/bussignyDeliveryMetafield", () => ({
  readShopifyDelivery48h: vi.fn().mockResolvedValue(false),
  writeShopifyDelivery48h: vi.fn().mockResolvedValue(undefined),
  ensureDelivery48hMetafieldDefinition: vi.fn().mockResolvedValue({ ok: true, created: false, id: "def-d48" }),
}));

vi.mock("@/shopify/restock/liquidationExpressPrice", () => ({
  syncLiquidationExpressPriceMetafield: vi.fn().mockResolvedValue({ expressPrice: 149.9, changed: true }),
}));

import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { resolvePhysicalRestockPricing } from "@/shopify/restock/physicalRestockPricing";
import { applyVariantSalePrice } from "@/shopify/restock/shopifyRestockInventory";
import { writeShopifyDelivery48h } from "@/shopify/restock/bussignyDeliveryMetafield";
import { syncLiquidationExpressPriceMetafield } from "@/shopify/restock/liquidationExpressPrice";
import { applyLiquidationSaleDisplay } from "@/shopify/restock/liquidationPricing";

const mockedPricing = resolvePhysicalRestockPricing as unknown as ReturnType<typeof vi.fn>;
const mockedSalePrice = applyVariantSalePrice as unknown as ReturnType<typeof vi.fn>;
const mockedGraphQL = shopifyGraphQL as unknown as ReturnType<typeof vi.fn>;
const mockedStxFindFirst = prisma.supplierVariant.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedStxUpdate = prisma.supplierVariant.update as unknown as ReturnType<typeof vi.fn>;
const mockedWrite48h = writeShopifyDelivery48h as unknown as ReturnType<typeof vi.fn>;
const mockedExpressSync = syncLiquidationExpressPriceMetafield as unknown as ReturnType<typeof vi.fn>;

const GTIN = "4550330121471";
const VARIANT = {
  variantId: "gid://shopify/ProductVariant/1",
  productId: "gid://shopify/Product/1",
  sku: "1183A872-752-37.5",
  price: 249,
  compareAtPrice: null,
  productTitle: "Onitsuka Tiger Mexico 66 Yellow",
};

describe("applyLiquidationSaleDisplay — hard gate on pricing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGraphQL.mockResolvedValue({
      data: {
        productVariant: { metafield: { value: "false" } },
        metafieldsSet: { userErrors: [] },
      },
      errors: undefined,
    });
    mockedStxFindFirst.mockResolvedValue({ id: "sv-1", manualLock: false, manualPrice: null });
  });

  it("forwards slug + sizeEu to the pricing resolver", async () => {
    mockedPricing.mockResolvedValue({
      stockxRaw: null,
      cost: null,
      compareAt: null,
      sellPrice: null,
      source: "none",
    });

    await applyLiquidationSaleDisplay({
      gtin: GTIN,
      variant: VARIANT,
      slug: "onitsuka-tiger-mexico-66-yellow",
      sizeEu: "37.5",
    });

    expect(mockedPricing).toHaveBeenCalledWith(GTIN, {
      slug: "onitsuka-tiger-mexico-66-yellow",
      sizeEu: "37.5",
    });
  });

  it("liq fail: no price write, no price_locked, applied=false + warning", async () => {
    mockedPricing.mockResolvedValue({
      stockxRaw: null,
      cost: null,
      compareAt: null,
      sellPrice: null,
      source: "none",
    });

    const result = await applyLiquidationSaleDisplay({ gtin: GTIN, variant: VARIANT });

    expect(result.applied).toBe(false);
    expect(result.salePrice).toBeNull();
    expect(result.warnings.join(" ")).toContain("No StockX pricing");
    expect(mockedSalePrice).not.toHaveBeenCalled();
    expect(mockedGraphQL).not.toHaveBeenCalled();
    expect(mockedStxUpdate).not.toHaveBeenCalled();
  });

  it("liq ok: price written + price_locked + DB manualLock", async () => {
    mockedPricing.mockResolvedValue({
      stockxRaw: null,
      buyNowAfterFees: 217,
      cost: 217,
      compareAt: 217,
      sellPrice: 108.5,
      siteSellPrice: 400,
      source: "stx-db",
    });

    const result = await applyLiquidationSaleDisplay({ gtin: GTIN, variant: VARIANT });

    expect(result.applied).toBe(true);
    expect(result.salePrice).toBe(108.5);
    expect(result.referencePrice).toBe(217);
    expect(mockedSalePrice).toHaveBeenCalledWith(
      expect.objectContaining({ salePrice: 108.5, compareAtPrice: 217 })
    );
    // price_locked read + write via GraphQL
    expect(mockedGraphQL).toHaveBeenCalled();
    expect(mockedStxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ manualLock: true, manualPrice: 108.5 }),
      })
    );
    expect(mockedWrite48h).toHaveBeenCalledWith("gid://shopify/ProductVariant/1", true);
    expect(mockedExpressSync).toHaveBeenCalledWith({
      variantId: "gid://shopify/ProductVariant/1",
      liquidationPriceChf: 108.5,
    });
  });

  it("warns loudly when no stx_ SupplierVariant exists for the DB lock", async () => {
    mockedStxFindFirst.mockResolvedValue(null);
    mockedPricing.mockResolvedValue({
      stockxRaw: 120,
      buyNowAfterFees: 152.78,
      cost: 152.78,
      compareAt: 152.78,
      sellPrice: 76,
      source: "kickdb-live-size",
    });

    const result = await applyLiquidationSaleDisplay({ gtin: GTIN, variant: VARIANT });

    expect(result.applied).toBe(true);
    expect(result.warnings.join(" ")).toContain("No stx_ SupplierVariant");
    expect(mockedStxUpdate).not.toHaveBeenCalled();
  });

  it("writes compareAt = after-fees Buy Now and price = half of it", async () => {
    mockedPricing.mockResolvedValue({
      stockxRaw: null,
      buyNowAfterFees: 76.81,
      cost: 76.81,
      compareAt: 76.81,
      sellPrice: 38,
      siteSellPrice: 120,
      source: "stx-db",
      storedBuyPrice: 76.81,
    });

    const result = await applyLiquidationSaleDisplay({ gtin: GTIN, variant: VARIANT });

    expect(result.applied).toBe(true);
    expect(mockedSalePrice).toHaveBeenCalledWith(
      expect.objectContaining({ salePrice: 38, compareAtPrice: 76.81 })
    );
  });
});
