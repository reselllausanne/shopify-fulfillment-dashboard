import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    supplierVariant: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("@/lib/shopifyAdmin", () => ({
  shopifyGraphQL: vi.fn(),
}));

vi.mock("@/shopify/inventory/physicalAvailability", () => ({
  loadPhysicalMirrorStockByGtin: vi.fn(),
}));

vi.mock("@/shopify/restock/shopifyRestockInventory", () => ({
  findShopifyVariantByGtin: vi.fn(),
  getShopifyVariantDetail: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/shopify/restock/createProductFullFlow", () => ({
  createProductFullFlow: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/shopify/restock/physicalRestockPricing", () => ({
  resolvePhysicalRestockPricing: vi.fn(),
}));

vi.mock("@/shopify/restock/bussignyDeliveryMetafield", () => ({
  BUSSIGNY_LOCATION_ID: "gid://shopify/Location/111267971458",
  readShopifyDelivery48h: vi.fn(),
  writeShopifyDelivery48h: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/shopify/restock/bussignySoldesMetafield", () => ({
  syncSoldes48hProductMetafield: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/shopify/inventory/locationConfig", () => ({
  ONLINE_LOCATION: { id: "gid://shopify/Location/999" },
  LIQUIDATION_LOCATION_IDS: [
    "gid://shopify/Location/111267971458",
    "gid://shopify/Location/111267250562",
    "gid://shopify/Location/111272100226",
  ],
  isLiquidationPhysicalLocation: (id: string) =>
    [
      "gid://shopify/Location/111267971458",
      "gid://shopify/Location/111267250562",
      "gid://shopify/Location/111272100226",
    ].includes(id),
}));

import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { loadPhysicalMirrorStockByGtin } from "@/shopify/inventory/physicalAvailability";
import { findShopifyVariantByGtin } from "@/shopify/restock/shopifyRestockInventory";
import { resolvePhysicalRestockPricing } from "@/shopify/restock/physicalRestockPricing";
import {
  readShopifyDelivery48h,
  writeShopifyDelivery48h,
} from "@/shopify/restock/bussignyDeliveryMetafield";
import { convergeVariant } from "@/shopify/inventory/convergence";

const mockedQueryRaw = prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>;
const mockedStxFindFirst = prisma.supplierVariant.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedGraphQL = shopifyGraphQL as unknown as ReturnType<typeof vi.fn>;
const mockedMirror = loadPhysicalMirrorStockByGtin as unknown as ReturnType<typeof vi.fn>;
const mockedFindVariant = findShopifyVariantByGtin as unknown as ReturnType<typeof vi.fn>;
const mockedPricing = resolvePhysicalRestockPricing as unknown as ReturnType<typeof vi.fn>;
const mockedRead48h = readShopifyDelivery48h as unknown as ReturnType<typeof vi.fn>;
const mockedWrite48h = writeShopifyDelivery48h as unknown as ReturnType<typeof vi.fn>;

const GTIN = "4550330121471";

function variantDetail(overrides: Record<string, unknown> = {}) {
  return {
    variantId: "gid://shopify/ProductVariant/1",
    productId: "gid://shopify/Product/1",
    productTitle: "Onitsuka Tiger Mexico 66 Yellow",
    productStatus: "ACTIVE",
    productHandle: "onitsuka-tiger-mexico-66-yellow",
    variantTitle: "37.5",
    inventoryItemId: "gid://shopify/InventoryItem/1",
    sku: "1183A872-752-37.5",
    barcode: GTIN,
    price: 249,
    compareAtPrice: null,
    onSale: false,
    ...overrides,
  };
}

describe("convergeVariant — 48h/soldes coupled to liquidation lock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedMirror.mockResolvedValue(new Map([[GTIN, { qty: 2 }]]));
    mockedQueryRaw.mockResolvedValue([{ available: 2 }]);
    mockedFindVariant.mockResolvedValue({
      match: variantDetail(),
      ambiguous: false,
      rawMatches: [],
    });
    mockedGraphQL.mockResolvedValue({
      data: {
        productVariant: { metafield: { value: "false" } },
        metafieldsSet: { userErrors: [] },
        productVariantsBulkUpdate: { userErrors: [] },
      },
      errors: undefined,
    });
    mockedRead48h.mockResolvedValue(false);
  });

  it("Bussigny>0 WITHOUT manualLock → dropship, does not set delivery_48h", async () => {
    mockedStxFindFirst.mockResolvedValue({
      id: "sv-1",
      supplierVariantId: "stx_v375",
      price: 110,
      manualLock: false,
      manualPrice: null,
      manualStock: null,
    });
    mockedPricing.mockResolvedValue({
      stockxRaw: null,
      cost: null,
      compareAt: null,
      sellPrice: null,
      source: "none",
    });

    const result = await convergeVariant(GTIN);

    expect(result.desired).toBe("dropship");
    expect(mockedWrite48h).not.toHaveBeenCalled();
  });

  it("Bussigny>0 WITH manualLock + pricing → liquidation, sets delivery_48h=true", async () => {
    mockedStxFindFirst.mockResolvedValue({
      id: "sv-1",
      supplierVariantId: "stx_v375",
      price: 110,
      manualLock: true,
      manualPrice: 129.9,
      manualStock: null,
    });
    mockedPricing.mockResolvedValue({
      stockxRaw: 120,
      cost: 185.6,
      compareAt: 219,
      sellPrice: 129.9,
      source: "kickdb-live-size",
    });

    const result = await convergeVariant(GTIN);

    expect(result.desired).toBe("liquidation");
    expect(mockedWrite48h).toHaveBeenCalledWith("gid://shopify/ProductVariant/1", true);
  });

  it("postPhysicalRestock at Lab without manualLock → liquidation (no revert)", async () => {
    mockedStxFindFirst.mockResolvedValue({
      id: "sv-1",
      supplierVariantId: "stx_v375",
      price: 110,
      manualLock: false,
      manualPrice: null,
      manualStock: null,
    });
    mockedPricing.mockResolvedValue({
      stockxRaw: 120,
      cost: 185.6,
      compareAt: 219,
      sellPrice: 129.9,
      source: "kickdb-live-size",
    });

    const result = await convergeVariant(GTIN, { postPhysicalRestock: true });

    expect(result.desired).toBe("liquidation");
    expect(mockedWrite48h).toHaveBeenCalledWith("gid://shopify/ProductVariant/1", true);
  });

  it("Bussigny=0 → clears delivery_48h even when it was set", async () => {
    mockedMirror.mockResolvedValue(new Map());
    mockedQueryRaw.mockResolvedValue([{ available: 0 }]);
    mockedRead48h.mockResolvedValue(true);
    mockedStxFindFirst.mockResolvedValue({
      id: "sv-1",
      supplierVariantId: "stx_v375",
      price: 110,
      manualLock: true,
      manualPrice: 129.9,
      manualStock: null,
    });
    mockedPricing.mockResolvedValue({
      stockxRaw: 120,
      cost: 185.6,
      compareAt: 219,
      sellPrice: 129.9,
      source: "kickdb-db",
    });

    const result = await convergeVariant(GTIN);

    expect(result.desired).toBe("dropship");
    expect(mockedWrite48h).toHaveBeenCalledWith("gid://shopify/ProductVariant/1", false);
  });

  it("afterWebSale + liquidation lane empty + stale soldes price → reverts to dropship", async () => {
    mockedMirror.mockResolvedValue(new Map());
    mockedQueryRaw.mockResolvedValue([{ available: 0 }]);
    mockedFindVariant.mockResolvedValue({
      match: variantDetail({ price: 139, compareAtPrice: null }),
      ambiguous: false,
      rawMatches: [],
    });
    mockedStxFindFirst.mockResolvedValue(null);
    mockedPricing.mockResolvedValue({
      stockxRaw: 168,
      cost: 201.44,
      compareAt: 289,
      sellPrice: 149,
      source: "kickdb-live",
    });

    const result = await convergeVariant(GTIN, { afterWebSale: true });

    expect(result.desired).toBe("dropship");
    expect(result.changes.some((c) => c.includes("deferred to post-sale KickDB upsert"))).toBe(
      true
    );
    expect(result.changes.some((c) => c.includes("reverted to dropship"))).toBe(false);
  });

  it("afterWebSale + liquidation lane stock remains + soldes price → stays liquidation", async () => {
    mockedMirror.mockResolvedValue(new Map([[GTIN, { qty: 1 }]]));
    mockedQueryRaw.mockResolvedValue([{ available: 1 }]);
    mockedFindVariant.mockResolvedValue({
      match: variantDetail({ price: 139, compareAtPrice: null }),
      ambiguous: false,
      rawMatches: [],
    });
    mockedStxFindFirst.mockResolvedValue(null);
    mockedPricing.mockResolvedValue({
      stockxRaw: 168,
      cost: 201.44,
      compareAt: 289,
      sellPrice: 149,
      source: "kickdb-live",
    });

    const result = await convergeVariant(GTIN, { afterWebSale: true });

    expect(result.desired).toBe("liquidation");
    expect(result.changes.some((c) => c.includes("reverted to dropship"))).toBe(false);
  });
});
