import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedGraphQL = vi.hoisted(() => vi.fn());
const mockedRead48h = vi.hoisted(() => vi.fn());
const mockedWrite48h = vi.hoisted(() => vi.fn());
const mockedReadExpressPrice = vi.hoisted(() => vi.fn());
const mockedWriteExpressPrice = vi.hoisted(() => vi.fn());

vi.mock("@/lib/shopifyAdmin", () => ({
  shopifyGraphQL: mockedGraphQL,
}));

vi.mock("@/shopify/restock/bussignyDeliveryMetafield", () => ({
  readShopifyDelivery48h: mockedRead48h,
  writeShopifyDelivery48h: mockedWrite48h,
}));

vi.mock("@/shopify/restock/liquidationExpressPrice", () => ({
  readShopifyExpressPriceMetafield: mockedReadExpressPrice,
  writeShopifyExpressPriceMetafield: mockedWriteExpressPrice,
}));

import { syncPhysicalExpressAvailability } from "@/shopify/inventory/syncPhysicalExpressAvailability";

describe("syncPhysicalExpressAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGraphQL.mockResolvedValue({
      data: {
        productVariant: { metafield: { value: "true" } },
        metafieldsSet: { userErrors: [] },
      },
    });
    mockedRead48h.mockResolvedValue(true);
    mockedWrite48h.mockResolvedValue(undefined);
    mockedReadExpressPrice.mockResolvedValue(89);
    mockedWriteExpressPrice.mockResolvedValue(undefined);
  });

  it("physical=0 on Essentials → express_available=false, delivery_48h=false, no price write", async () => {
    const result = await syncPhysicalExpressAvailability({
      variantId: "gid://shopify/ProductVariant/1",
      physicalQty: 0,
      productId: "15340411617666",
      title: "Essentials Tee Stretch Limo SS22",
    });

    expect(result.expressAvailable).toBe(false);
    expect(result.delivery48h).toBe(false);
    expect(mockedWrite48h).toHaveBeenCalledWith("gid://shopify/ProductVariant/1", false);
    expect(mockedWriteExpressPrice).not.toHaveBeenCalled();
    expect(
      mockedGraphQL.mock.calls.some((c) => String(c[0]).includes("SetExpressAvailable"))
    ).toBe(true);
  });

  it("physical>0 on Essentials → express on + express_price 89, delivery_48h stays off (no soldes)", async () => {
    mockedGraphQL.mockResolvedValue({
      data: {
        productVariant: { metafield: { value: "false" } },
        metafieldsSet: { userErrors: [] },
      },
    });
    mockedRead48h.mockResolvedValue(true);
    mockedReadExpressPrice.mockResolvedValue(null);

    const result = await syncPhysicalExpressAvailability({
      variantId: "gid://shopify/ProductVariant/1",
      physicalQty: 2,
      productId: "15340411617666",
      title: "Essentials Tee Stretch Limo SS22",
    });

    expect(result.expressAvailable).toBe(true);
    expect(result.delivery48h).toBe(false);
    expect(mockedWrite48h).toHaveBeenCalledWith("gid://shopify/ProductVariant/1", false);
    expect(mockedWriteExpressPrice).toHaveBeenCalledWith(
      "gid://shopify/ProductVariant/1",
      89
    );
  });

  it("clears stale express_available after a non-fixed-price pair sells out", async () => {
    mockedRead48h.mockResolvedValue(false);

    const result = await syncPhysicalExpressAvailability({
      variantId: "gid://shopify/ProductVariant/1",
      physicalQty: 0,
      sku: "604133-050-41",
      title: "Nike Air Max Plus Triple Black",
    });

    expect(result.changes).toContain("Shopify express_available=false (physical=0)");
    expect(
      mockedGraphQL.mock.calls.some(
        (call) =>
          String(call[0]).includes("SetExpressAvailable") &&
          call[1]?.metafields?.[0]?.value === "false"
      )
    ).toBe(true);
  });

  it("enables express only for non-fixed-price variant with physical stock", async () => {
    mockedGraphQL.mockResolvedValue({
      data: {
        productVariant: { metafield: { value: "false" } },
        metafieldsSet: { userErrors: [] },
      },
    });

    const result = await syncPhysicalExpressAvailability({
      variantId: "gid://shopify/ProductVariant/1",
      physicalQty: 1,
      sku: "604133-050-41",
      title: "Nike Air Max Plus Triple Black",
    });

    expect(result.expressAvailable).toBe(true);
    expect(
      mockedGraphQL.mock.calls.some(
        (call) =>
          String(call[0]).includes("SetExpressAvailable") &&
          call[1]?.metafields?.[0]?.value === "true"
      )
    ).toBe(true);
    expect(mockedWrite48h).not.toHaveBeenCalled();
  });
});
