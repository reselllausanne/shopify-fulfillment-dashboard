import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    supplierVariant: {
      findFirst: vi.fn(),
    },
    kickDBVariant: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/shopifyAdmin", () => ({
  shopifyGraphQL: vi.fn(),
}));

vi.mock("@/galaxus/pricing/suggestedSellPrice", () => ({
  deriveStockxRawAskFromStoredBuyPrice: vi.fn().mockReturnValue(120),
}));

vi.mock("@/shopify/pricing/calcShopifySellPrice", () => ({
  calcShopifySellPrice: vi.fn().mockImplementation(({ isExpress }: { isExpress?: boolean }) =>
    isExpress ? 229 : 199
  ),
}));

vi.mock("@/shopify/restock/shopifyRestockInventory", () => ({
  findShopifyVariantByGtin: vi.fn(),
}));

import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { syncShopifyStxPricesForSupplierVariantIds } from "@/shopify/stx/syncShopifyStxPrices";

const mockedFindSupplier = prisma.supplierVariant.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedGraphQL = shopifyGraphQL as unknown as ReturnType<typeof vi.fn>;

describe("syncShopifyStxPricesForSupplierVariantIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates Shopify by handle+size for PENDING_GTIN rows", async () => {
    mockedFindSupplier.mockResolvedValue({
      supplierVariantId: "stx_test_1",
      gtin: null,
      sizeRaw: "37.5",
      supplierProductName: "Onitsuka Tiger Mexico 66",
      supplierBrand: "Onitsuka Tiger",
      deliveryType: "standard",
      price: 110,
      standardBuyPrice: 110,
      expressBuyPrice: null,
      mappings: [
        {
          kickdbVariant: {
            sizeEu: "37.5",
            sizeUs: "6.5",
            product: { urlKey: "onitsuka-tiger-mexico-66-sd-kill-bill-yellow-midsole-2024" },
          },
        },
      ],
    });

    mockedGraphQL
      // PRODUCT_BY_HANDLE_QUERY
      .mockResolvedValueOnce({
        data: {
          products: {
            nodes: [
              {
                id: "gid://shopify/Product/1",
                handle: "onitsuka-tiger-mexico-66-sd-kill-bill-yellow-midsole-2024",
                variants: {
                  nodes: [
                    {
                      id: "gid://shopify/ProductVariant/1",
                      title: "37.5",
                      sku: "1183A872-752-37.5",
                      product: { id: "gid://shopify/Product/1" },
                      usSize: { value: "6.5" },
                    },
                  ],
                },
              },
            ],
          },
        },
        errors: undefined,
      })
      // PRICE_LOCK_QUERY
      .mockResolvedValueOnce({
        data: { productVariant: { metafield: { value: "false" } } },
        errors: undefined,
      })
      // VARIANT_PRICE_MUTATION
      .mockResolvedValueOnce({
        data: { productVariantsBulkUpdate: { userErrors: [] } },
        errors: undefined,
      });

    const res = await syncShopifyStxPricesForSupplierVariantIds(["stx_test_1"]);
    expect(res.synced).toBe(1);
    expect(res.results[0]).toEqual(
      expect.objectContaining({
        supplierVariantId: "stx_test_1",
        ok: true,
        matchedVariantId: "gid://shopify/ProductVariant/1",
        normalPrice: 199,
      })
    );
  });

  it("skips when no Shopify variant matches by size", async () => {
    mockedFindSupplier.mockResolvedValue({
      supplierVariantId: "stx_test_2",
      gtin: null,
      sizeRaw: "37.5",
      supplierProductName: "Onitsuka Tiger Mexico 66",
      supplierBrand: "Onitsuka Tiger",
      deliveryType: "standard",
      price: 110,
      standardBuyPrice: 110,
      expressBuyPrice: null,
      mappings: [
        {
          kickdbVariant: {
            sizeEu: "37.5",
            sizeUs: "6.5",
            product: { urlKey: "onitsuka-tiger-mexico-66-sd-kill-bill-yellow-midsole-2024" },
          },
        },
      ],
    });
    mockedGraphQL.mockResolvedValueOnce({
      data: {
        products: {
          nodes: [
            {
              id: "gid://shopify/Product/1",
              handle: "onitsuka-tiger-mexico-66-sd-kill-bill-yellow-midsole-2024",
              variants: {
                nodes: [
                  {
                    id: "gid://shopify/ProductVariant/2",
                    title: "45",
                    sku: "x",
                    product: { id: "gid://shopify/Product/1" },
                    usSize: { value: "11" },
                  },
                ],
              },
            },
          ],
        },
      },
      errors: undefined,
    });

    const res = await syncShopifyStxPricesForSupplierVariantIds(["stx_test_2"]);
    expect(res.synced).toBe(0);
    expect(res.results[0]?.reason).toBe("no_shopify_variant_by_size");
  });
});
