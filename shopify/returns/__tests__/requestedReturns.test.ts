import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockShopifyGraphQL, prismaMock } = vi.hoisted(() => ({
  mockShopifyGraphQL: vi.fn(),
  prismaMock: {
    marketplaceReturn: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    marketplaceReturnSyncCursor: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/shopifyAdmin", () => ({
  shopifyGraphQL: (...args: any[]) => mockShopifyGraphQL(...args),
}));

vi.mock("@/app/lib/prisma", () => ({
  prisma: prismaMock,
}));

vi.mock("@/shopify/returns/label", () => ({
  generateShopifyReturnLabel: vi.fn().mockResolvedValue({
    labelKey: "abc123.pdf",
    labelPublicUrl: "https://solution.resell-lausanne.ch/api/shopify/returns/label/abc123.pdf",
    trackingNumber: "99.6000.1234.5678.90",
    trackingUrl: "https://service.post.ch/ekp-web/ui/entry/search/99.6000.1234.5678.90",
    filePath: "/tmp/abc123.pdf",
    mimeType: "application/pdf",
    swissResponse: { ok: true },
  }),
}));

import {
  acceptRequestedShopifyReturn,
  listRequestedShopifyReturns,
  syncShopifyReturnsFromAdmin,
} from "../requestedReturns";

describe("requestedReturns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.marketplaceReturn.findMany.mockResolvedValue([]);
    prismaMock.marketplaceReturn.findUnique.mockResolvedValue(null);
    prismaMock.marketplaceReturn.upsert.mockResolvedValue({ id: "local-1" });
    prismaMock.marketplaceReturnSyncCursor.upsert.mockResolvedValue({ platform: "shopify" });
  });

  it("lists REQUESTED returns from Shopify orders", async () => {
    mockShopifyGraphQL.mockResolvedValueOnce({
      data: {
        orders: {
          edges: [
            {
              node: {
                id: "gid://shopify/Order/6141",
                name: "#6141",
                returns: {
                  edges: [
                    {
                      node: {
                        id: "gid://shopify/Return/99",
                        name: "#6141-R1",
                        status: "REQUESTED",
                        createdAt: "2026-06-10T20:24:00Z",
                        reverseFulfillmentOrders: { edges: [] },
                        returnLineItems: {
                          edges: [
                            {
                              node: {
                                id: "gid://shopify/ReturnLineItem/1",
                                quantity: 1,
                                customerNote: "Too wide",
                                restockingFee: {
                                  percentage: 10,
                                  amountSet: {
                                    shopMoney: { amount: "17.49", currencyCode: "CHF" },
                                  },
                                },
                                returnReasonDefinition: {
                                  handle: "too-wide",
                                  name: "Too wide",
                                },
                                fulfillmentLineItem: {
                                  lineItem: {
                                    id: "gid://shopify/LineItem/1",
                                    title: "Nike Dunk Low Retro Lettering",
                                    name: "Nike Dunk Low Retro Lettering",
                                    sku: "HV5749-110-43",
                                    variantTitle: "43",
                                    originalUnitPriceSet: {
                                      shopMoney: { amount: "189.00", currencyCode: "CHF" },
                                    },
                                  },
                                },
                              },
                            },
                          ],
                        },
                        order: {
                          id: "gid://shopify/Order/6141",
                          name: "#6141",
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    });

    const result = await listRequestedShopifyReturns();
    expect(result.returns).toHaveLength(1);
    expect(result.returns[0].returnName).toBe("#6141-R1");
    expect(result.returns[0].lineItems[0].sku).toBe("HV5749-110-43");
    expect(result.returns[0].lineItems[0].returnReasonLabel).toBe("Too wide");
  });

  it("hides returns already approved in Shopify or tracked locally", async () => {
    mockShopifyGraphQL.mockResolvedValueOnce({
      data: {
        orders: {
          edges: [
            {
              node: {
                id: "gid://shopify/Order/1",
                name: "#6326",
                returns: {
                  edges: [
                    {
                      node: {
                        id: "gid://shopify/Return/open",
                        name: "#6326-R1",
                        status: "OPEN",
                        createdAt: "2026-07-07T11:56:00Z",
                        reverseFulfillmentOrders: {
                          edges: [{ node: { id: "gid://shopify/ReverseFulfillmentOrder/1" } }],
                        },
                        returnLineItems: { edges: [] },
                      },
                    },
                    {
                      node: {
                        id: "gid://shopify/Return/tracked",
                        name: "#6355-R1",
                        status: "REQUESTED",
                        createdAt: "2026-07-15T17:19:00Z",
                        reverseFulfillmentOrders: { edges: [] },
                        returnLineItems: {
                          edges: [
                            {
                              node: {
                                id: "gid://shopify/ReturnLineItem/2",
                                quantity: 1,
                                fulfillmentLineItem: {
                                  lineItem: {
                                    title: "Shorts",
                                    sku: "SKU-1",
                                    originalUnitPriceSet: {
                                      shopMoney: { amount: "59.00", currencyCode: "CHF" },
                                    },
                                  },
                                },
                              },
                            },
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    });

    prismaMock.marketplaceReturn.findMany.mockResolvedValueOnce([
      { externalReturnId: "gid://shopify/Return/tracked" },
    ]);

    const result = await listRequestedShopifyReturns();
    expect(result.returns).toHaveLength(0);
  });

  it("accepts a REQUESTED return and persists label", async () => {
    mockShopifyGraphQL.mockImplementation(async (query: string) => {
      if (query.includes("query ReturnDetailForAccept")) {
        return {
          data: {
            return: {
              id: "gid://shopify/Return/99",
              name: "#6141-R1",
              status: "REQUESTED",
              returnLineItems: {
                edges: [
                  {
                    node: {
                      id: "gid://shopify/ReturnLineItem/1",
                      quantity: 1,
                      customerNote: "Too wide",
                      returnReasonDefinition: { handle: "too-wide", name: "Too wide" },
                      fulfillmentLineItem: {
                        id: "gid://shopify/FulfillmentLineItem/1",
                        lineItem: {
                          id: "gid://shopify/LineItem/1",
                          title: "Nike Dunk Low Retro Lettering",
                          sku: "HV5749-110-43",
                          variantTitle: "43",
                          originalUnitPriceSet: {
                            shopMoney: { amount: "189.00", currencyCode: "CHF" },
                          },
                        },
                      },
                    },
                  },
                ],
              },
              order: {
                id: "gid://shopify/Order/6141",
                name: "#6141",
                customer: {
                  id: "gid://shopify/Customer/1",
                  defaultEmailAddress: { emailAddress: "buyer@example.com" },
                },
              },
            },
          },
        };
      }
      if (query.includes("mutation ReturnApproveRequest")) {
        return {
          data: {
            returnApproveRequest: {
              return: {
                id: "gid://shopify/Return/99",
                name: "#6141-R1",
                status: "OPEN",
                reverseFulfillmentOrders: {
                  edges: [{ node: { id: "gid://shopify/ReverseFulfillmentOrder/1" } }],
                },
                order: {
                  id: "gid://shopify/Order/6141",
                  name: "#6141",
                  customer: { id: "gid://shopify/Customer/1" },
                },
              },
              userErrors: [],
            },
          },
        };
      }
      if (query.includes("mutation CreateReverseDeliveryWithExternalLabel")) {
        return {
          data: {
            reverseDeliveryCreateWithShipping: {
              reverseDelivery: {
                id: "gid://shopify/ReverseDelivery/1",
                deliverable: {
                  label: {
                    publicFileUrl:
                      "https://solution.resell-lausanne.ch/api/shopify/returns/label/abc123.pdf",
                  },
                  tracking: {
                    number: "99.6000.1234.5678.90",
                    url: "https://service.post.ch/ekp-web/ui/entry/search/99.6000.1234.5678.90",
                  },
                },
              },
              userErrors: [],
            },
          },
        };
      }
      return { data: {} };
    });

    const result = await acceptRequestedShopifyReturn("gid://shopify/Return/99", {
      publicBaseUrl: "https://solution.resell-lausanne.ch",
    });

    expect(result.success).toBe(true);
    expect(result.name).toBe("#6141-R1");
    expect(result.returnTrackingNumber).toBe("99.6000.1234.5678.90");
    expect(prismaMock.marketplaceReturn.upsert).toHaveBeenCalledTimes(1);
  });

  it("syncs OPEN Shopify returns into local pending list", async () => {
    mockShopifyGraphQL.mockResolvedValueOnce({
      data: {
        orders: {
          edges: [
            {
              node: {
                id: "gid://shopify/Order/6326",
                name: "#6326",
                email: "buyer@example.com",
                customer: null,
                returns: {
                  edges: [
                    {
                      node: {
                        id: "gid://shopify/Return/open",
                        name: "#6326-R1",
                        status: "OPEN",
                        createdAt: "2026-07-07T11:56:00Z",
                        reverseFulfillmentOrders: {
                          edges: [
                            {
                              node: {
                                id: "gid://shopify/ReverseFulfillmentOrder/1",
                                reverseDeliveries: {
                                  edges: [
                                    {
                                      node: {
                                        id: "gid://shopify/ReverseDelivery/1",
                                        deliverable: {
                                          label: {
                                            publicFileUrl:
                                              "https://cdn.shopify.com/label.pdf",
                                          },
                                          tracking: {
                                            number: "99.6000.9999.0000.11",
                                            url: "https://service.post.ch/track/99",
                                          },
                                        },
                                      },
                                    },
                                  ],
                                },
                              },
                            },
                          ],
                        },
                        returnLineItems: {
                          edges: [
                            {
                              node: {
                                id: "gid://shopify/ReturnLineItem/1",
                                quantity: 1,
                                fulfillmentLineItem: {
                                  lineItem: {
                                    title: "Air Jordan 1",
                                    sku: "AJ1-42",
                                    originalUnitPriceSet: {
                                      shopMoney: { amount: "199.00", currencyCode: "CHF" },
                                    },
                                  },
                                },
                              },
                            },
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    });
    prismaMock.marketplaceReturn.findMany.mockResolvedValueOnce([]);

    const result = await syncShopifyReturnsFromAdmin();
    expect(result.upserted).toBe(1);
    expect(result.requestedCount).toBe(0);
    expect(prismaMock.marketplaceReturn.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.marketplaceReturnSyncCursor.upsert).toHaveBeenCalledTimes(1);
  });
});
