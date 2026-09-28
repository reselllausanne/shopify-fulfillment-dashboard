import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  orderMatch: { findMany: vi.fn() },
  shopifyOrder: { findMany: vi.fn() },
  supplierVariant: { findMany: vi.fn() },
  shopifyVariantLocationStock: { findMany: vi.fn() },
}));
const shopifyGraphQLMock = vi.hoisted(() => vi.fn());
const fulfillmentMapMock = vi.hoisted(() => vi.fn());
const shippingInfoMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/shopifyAdmin", () => ({ shopifyGraphQL: shopifyGraphQLMock }));
vi.mock("@/lib/shopifyFulfillment", () => ({
  fetchOrderFulfillmentMap: fulfillmentMapMock,
  fetchOrderShippingInfo: shippingInfoMock,
}));

import {
  buildOpenOrdersBySkuSearchQuery,
  resolveVerifiedShopifyAwbFallback,
} from "@/app/lib/shopifyOpenLineCandidates";
import { dropLinesLinkedElsewhere, resolveShopifyAwbFallbackMatch } from "@/app/lib/shopifyAwbFallback";

type LiveLine = { id: string; sku: string; variantTitle: string; remaining: number };

function liveOrder(orderId: string, lines: LiveLine[]) {
  fulfillmentMapMock.mockImplementation(async (id: string) =>
    ORDERS[id]
      ? {
          order: {
            fulfillmentOrders: {
              nodes: [
                {
                  status: "OPEN",
                  lineItems: {
                    nodes: ORDERS[id].map((l) => ({
                      remainingQuantity: l.remaining,
                      variant: { id: `v-${l.id}`, sku: l.sku },
                    })),
                  },
                },
              ],
            },
          },
        }
      : { order: null }
  );
  shippingInfoMock.mockImplementation(async (id: string) =>
    ORDERS[id]
      ? {
          cancelledAt: null,
          lineItems: {
            nodes: ORDERS[id].map((l) => ({
              id: l.id,
              title: "Air Jordan 1",
              variantTitle: l.variantTitle,
              sku: l.sku,
              quantity: 1,
              variant: { id: `v-${l.id}`, sku: l.sku },
            })),
          },
        }
      : null
  );
  ORDERS[orderId] = lines;
}

let ORDERS: Record<string, LiveLine[]> = {};

const PKG = {
  awb: "1ZNOMATCH",
  sku: "DZ5485-612",
  sizeEU: "42",
  productName: "Air Jordan 1 High",
  purchaseDate: "2026-09-20T12:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  ORDERS = {};
  // No pre-existing OrderMatch anywhere.
  prismaMock.orderMatch.findMany.mockResolvedValue([]);
  prismaMock.shopifyOrder.findMany.mockResolvedValue([]);
  prismaMock.supplierVariant.findMany.mockResolvedValue([]);
  prismaMock.shopifyVariantLocationStock.findMany.mockResolvedValue([
    { sku: "DZ5485-612-42" },
    { sku: "DZ5485-612-43" },
  ]);
});

function shopifySearchReturns(orders: Array<{ id: string; name: string; createdAt: string }>) {
  shopifyGraphQLMock.mockResolvedValue({
    data: { orders: { nodes: orders.map((o) => ({ ...o, cancelledAt: null })) } },
  });
}

describe("unmatched AWB → open Shopify order discovery (no OrderMatch)", () => {
  it("proposes the only open order of the same SKU + size as exact", async () => {
    shopifySearchReturns([
      { id: "gid://shopify/Order/1", name: "#1001", createdAt: "2026-09-10T08:00:00Z" },
    ]);
    liveOrder("gid://shopify/Order/1", [
      { id: "gid://shopify/LineItem/11", sku: "DZ5485-612-42", variantTitle: "42", remaining: 1 },
    ]);

    const out = await resolveVerifiedShopifyAwbFallback(PKG);
    expect(out.status).toBe("exact");
    if (out.status === "exact") {
      expect(out.candidate.shopifyLineItemId).toBe("gid://shopify/LineItem/11");
    }
    const query = shopifyGraphQLMock.mock.calls[0][1].query as string;
    expect(query).toContain('sku:"DZ5485-612-42"');
    expect(query).toContain("fulfillment_status:unfulfilled");
  });

  it("filters other sizes and lists remaining candidates oldest first", async () => {
    shopifySearchReturns([
      { id: "gid://shopify/Order/2", name: "#1002", createdAt: "2026-09-12T08:00:00Z" },
      { id: "gid://shopify/Order/1", name: "#1001", createdAt: "2026-09-05T08:00:00Z" },
      { id: "gid://shopify/Order/3", name: "#1003", createdAt: "2026-09-08T08:00:00Z" },
    ]);
    liveOrder("gid://shopify/Order/1", [
      { id: "gid://shopify/LineItem/11", sku: "DZ5485-612-42", variantTitle: "42", remaining: 1 },
    ]);
    liveOrder("gid://shopify/Order/2", [
      { id: "gid://shopify/LineItem/21", sku: "DZ5485-612-42", variantTitle: "42", remaining: 1 },
    ]);
    liveOrder("gid://shopify/Order/3", [
      { id: "gid://shopify/LineItem/31", sku: "DZ5485-612-43", variantTitle: "43", remaining: 1 },
    ]);

    const out = await resolveVerifiedShopifyAwbFallback(PKG);
    expect(out.status).toBe("ambiguous");
    if (out.status === "ambiguous") {
      expect(out.candidates.map((c) => c.shopifyLineItemId)).toEqual([
        "gid://shopify/LineItem/11",
        "gid://shopify/LineItem/21",
      ]);
    }
  });

  it("drops orders placed after the StockX buy and fully fulfilled lines", async () => {
    shopifySearchReturns([
      { id: "gid://shopify/Order/1", name: "#1001", createdAt: "2026-09-10T08:00:00Z" },
      { id: "gid://shopify/Order/4", name: "#1004", createdAt: "2026-09-21T08:00:00Z" },
    ]);
    liveOrder("gid://shopify/Order/1", [
      { id: "gid://shopify/LineItem/11", sku: "DZ5485-612-42", variantTitle: "42", remaining: 0 },
    ]);
    liveOrder("gid://shopify/Order/4", [
      { id: "gid://shopify/LineItem/41", sku: "DZ5485-612-42", variantTitle: "42", remaining: 1 },
    ]);
    expect((await resolveVerifiedShopifyAwbFallback(PKG)).status).toBe("none");
  });

  it("never auto-links when purchase date is unknown (single candidate → proposal)", async () => {
    shopifySearchReturns([
      { id: "gid://shopify/Order/1", name: "#1001", createdAt: "2026-09-10T08:00:00Z" },
    ]);
    liveOrder("gid://shopify/Order/1", [
      { id: "gid://shopify/LineItem/11", sku: "DZ5485-612-42", variantTitle: "42", remaining: 1 },
    ]);
    const out = await resolveVerifiedShopifyAwbFallback({ ...PKG, purchaseDate: null });
    expect(out.status).toBe("ambiguous");
    if (out.status === "ambiguous") expect(out.reason).toBe("no_purchase_date");
  });

  it("skips a line already linked to another parcel AWB", async () => {
    shopifySearchReturns([
      { id: "gid://shopify/Order/1", name: "#1001", createdAt: "2026-09-10T08:00:00Z" },
    ]);
    liveOrder("gid://shopify/Order/1", [
      { id: "gid://shopify/LineItem/11", sku: "DZ5485-612-42", variantTitle: "42", remaining: 1 },
    ]);
    prismaMock.orderMatch.findMany.mockImplementation(async (args: any) =>
      args?.where?.shopifyLineItemId
        ? [{ shopifyLineItemId: "gid://shopify/LineItem/11", stockxAwb: "1ZOTHER", matchType: "auto" }]
        : []
    );
    expect((await resolveVerifiedShopifyAwbFallback(PKG)).status).toBe("none");
  });
});

describe("buildOpenOrdersBySkuSearchQuery", () => {
  it("quotes SKUs, dedupes, and bounds the 2-month window", () => {
    const q = buildOpenOrdersBySkuSearchQuery(
      ["A-42", "A-42", ' B"1 '],
      new Date("2026-07-28T00:00:00Z")
    );
    expect(q).toBe(
      '(sku:"A-42" OR sku:"B\\"1") (fulfillment_status:unfulfilled OR fulfillment_status:partial) -status:cancelled created:>=2026-07-28'
    );
    expect(buildOpenOrdersBySkuSearchQuery([], new Date())).toBeNull();
  });
});

describe("dropLinesLinkedElsewhere", () => {
  const line = (id: string) => ({
    shopifyOrderId: "o",
    shopifyOrderName: "#1",
    shopifyLineItemId: id,
    shopifySku: "X-42",
    shopifySizeEU: "42",
    shopifyProductTitle: "X",
    shopifyCreatedAt: "2026-09-01T00:00:00Z",
    remainingQuantity: 1,
  });
  it("keeps unmatched / empty-AWB / same-AWB lines, drops other AWB and owned-stock lines", () => {
    const out = dropLinesLinkedElsewhere(
      [line("a"), line("b"), line("c"), line("d"), line("e")],
      [
        { shopifyLineItemId: "b", stockxAwb: null, matchType: "auto" },
        { shopifyLineItemId: "c", stockxAwb: "1ZOTHER", matchType: "auto" },
        { shopifyLineItemId: "d", stockxAwb: "1zscan", matchType: "auto" },
        { shopifyLineItemId: "e", stockxAwb: null, matchType: "physical_fulfillment" },
      ],
      ["1ZSCAN"]
    );
    expect(out.map((l) => l.shopifyLineItemId)).toEqual(["a", "b", "d"]);
  });

  it("resolver lists the oldest customer order first", () => {
    const out = resolveShopifyAwbFallbackMatch(PKG, [
      { ...line("new"), shopifySku: "DZ5485-612-42", shopifyCreatedAt: "2026-09-15T00:00:00Z" },
      { ...line("old"), shopifySku: "DZ5485-612-42", shopifyCreatedAt: "2026-09-02T00:00:00Z" },
    ]);
    expect(out.status).toBe("ambiguous");
    if (out.status === "ambiguous") {
      expect(out.candidates[0].shopifyLineItemId).toBe("old");
    }
  });
});
