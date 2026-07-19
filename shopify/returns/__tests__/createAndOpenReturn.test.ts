import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockShopifyGraphQL, prismaMock, mockGenerateShopifyReturnLabel } = vi.hoisted(() => ({
  mockShopifyGraphQL: vi.fn(),
  prismaMock: {
    marketplaceReturn: {
      upsert: vi.fn(),
    },
  },
  mockGenerateShopifyReturnLabel: vi.fn(),
}));

vi.mock("@/lib/shopifyAdmin", () => ({
  shopifyGraphQL: (...args: any[]) => mockShopifyGraphQL(...args),
}));

vi.mock("@/app/lib/prisma", () => ({
  prisma: prismaMock,
}));

vi.mock("@/shopify/returns/label", () => ({
  generateShopifyReturnLabel: (...args: any[]) => mockGenerateShopifyReturnLabel(...args),
}));

import {
  ShopifyReturnRequestError,
  createAndOpenReturnFromFormData,
  mapFormReasonToShopify,
  normalizeOrderNumber,
} from "../createAndOpenReturn";

function setupHappyPathGraphqlMocks() {
  mockGenerateShopifyReturnLabel.mockResolvedValue({
    labelKey: "abc123.pdf",
    labelPublicUrl: "https://solution.resell-lausanne.ch/api/shopify/returns/label/abc123.pdf",
    trackingNumber: "99.6000.1234.5678.90",
    trackingUrl: "https://service.post.ch/ekp-web/ui/entry/search/99.6000.1234.5678.90",
    filePath: "/tmp/abc123.pdf",
    mimeType: "application/pdf",
    swissResponse: { ok: true },
  });

  mockShopifyGraphQL.mockImplementation(async (query: string, variables: any) => {
    if (query.includes("query OrderLookupForReturn")) {
      return {
        data: {
          orders: {
            edges: [
              {
                node: {
                  id: "gid://shopify/Order/1",
                  name: "#1234",
                  email: "customer@example.com",
                  customer: {
                    id: "gid://shopify/Customer/1",
                    email: "customer@example.com",
                    defaultEmailAddress: { emailAddress: "customer@example.com" },
                  },
                },
              },
            ],
          },
        },
      };
    }
    if (query.includes("query ReturnableFulfillmentsForOrder")) {
      return {
        data: {
          returnableFulfillments: {
            edges: [
              {
                node: {
                  returnableFulfillmentLineItems: {
                    edges: [
                      {
                        node: {
                          quantity: 2,
                          fulfillmentLineItem: {
                            id: "gid://shopify/FulfillmentLineItem/77",
                            lineItem: {
                              id: "gid://shopify/LineItem/91",
                              title: "Nike Dunk",
                              sku: "SKU-1",
                              originalUnitPriceSet: {
                                shopMoney: {
                                  amount: "100.00",
                                  currencyCode: "CHF",
                                },
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
      };
    }
    if (query.includes("mutation ReturnRequestCreate")) {
      expect(variables.input.returnLineItems[0].returnReason).toBe("SIZE_TOO_SMALL");
      return {
        data: {
          returnRequest: {
            return: {
              id: "gid://shopify/Return/12",
              name: "#1234-R1",
              status: "REQUESTED",
              order: { id: "gid://shopify/Order/1", name: "#1234" },
            },
            userErrors: [],
          },
        },
      };
    }
    if (query.includes("mutation ReturnApproveRequest")) {
      return {
        data: {
          returnApproveRequest: {
            return: {
              id: "gid://shopify/Return/12",
              name: "#1234-R1",
              status: "OPEN",
              reverseFulfillmentOrders: {
                edges: [{ node: { id: "gid://shopify/ReverseFulfillmentOrder/44" } }],
              },
              order: {
                id: "gid://shopify/Order/1",
                name: "#1234",
                customer: {
                  id: "gid://shopify/Customer/1",
                  email: "customer@example.com",
                },
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
              id: "gid://shopify/ReverseDelivery/8",
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
    throw new Error(`Unexpected query: ${query.slice(0, 60)}`);
  });
}

describe("createAndOpenReturnFromFormData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes order number and reason mapping", () => {
    expect(normalizeOrderNumber("1234")).toBe("#1234");
    expect(normalizeOrderNumber("#999")).toBe("#999");
    expect(mapFormReasonToShopify("WRONG_SIZE")).toBe("SIZE_TOO_SMALL");
    expect(mapFormReasonToShopify("SIZE_CHANGE")).toBe("SIZE_TOO_SMALL");
    expect(mapFormReasonToShopify("WRONG_ITEM")).toBe("WRONG_ITEM");
    expect(mapFormReasonToShopify("WRONG_ITEM_RECEIVED")).toBe("WRONG_ITEM");
    expect(mapFormReasonToShopify("DAMAGED")).toBe("DEFECTIVE");
    expect(mapFormReasonToShopify("DEFECTIVE_ITEM")).toBe("DEFECTIVE");
    expect(mapFormReasonToShopify("CHANGE_OF_MIND")).toBe("OTHER");
    expect(mapFormReasonToShopify("NON_CONFORMITY")).toBe("OTHER");
    expect(mapFormReasonToShopify("OTHER")).toBe("OTHER");
    expect(mapFormReasonToShopify("RANDOM")).toBe("OTHER");
  });

  it("throws INVALID_ORDER_NUMBER for bare digits", async () => {
    await expect(
      createAndOpenReturnFromFormData({
        orderNumber: "6141",
        reason: "OTHER",
        details: "test",
      })
    ).rejects.toMatchObject({ code: "INVALID_ORDER_NUMBER" });
  });

  it("throws EMAIL_MISMATCH when order email differs", async () => {
    mockShopifyGraphQL.mockImplementation(async (query: string) => {
      if (query.includes("query OrderLookupForReturn")) {
        return {
          data: {
            orders: {
              edges: [
                {
                  node: {
                    id: "gid://shopify/Order/1",
                    name: "#1234",
                    email: "another@example.com",
                    customer: {
                      id: "gid://shopify/Customer/1",
                      email: "another@example.com",
                      defaultEmailAddress: { emailAddress: "another@example.com" },
                    },
                  },
                },
              ],
            },
          },
        };
      }
      throw new Error("Unexpected query");
    });

    await expect(
      createAndOpenReturnFromFormData({
        orderNumber: "#1234",
        email: "customer@example.com",
        reason: "OTHER",
        details: "need return",
      })
    ).rejects.toMatchObject({ code: "EMAIL_MISMATCH" });
  });

  it("throws NO_RETURNABLE_ITEMS when no returnable lines", async () => {
    mockShopifyGraphQL.mockImplementation(async (query: string) => {
      if (query.includes("query OrderLookupForReturn")) {
        return {
          data: {
            orders: {
              edges: [
                {
                  node: {
                    id: "gid://shopify/Order/1",
                    name: "#1234",
                    email: "customer@example.com",
                    customer: {
                      id: "gid://shopify/Customer/1",
                      email: "customer@example.com",
                      defaultEmailAddress: { emailAddress: "customer@example.com" },
                    },
                  },
                },
              ],
            },
          },
        };
      }
      if (query.includes("query ReturnableFulfillmentsForOrder")) {
        return {
          data: {
            returnableFulfillments: { edges: [] },
          },
        };
      }
      throw new Error("Unexpected query");
    });

    await expect(
      createAndOpenReturnFromFormData({
        orderNumber: "#1234",
        email: "customer@example.com",
        reason: "OTHER",
        details: "need return",
      })
    ).rejects.toMatchObject({ code: "NO_RETURNABLE_ITEMS" });
  });

  it("creates and approves return then upserts marketplace return row", async () => {
    setupHappyPathGraphqlMocks();
    prismaMock.marketplaceReturn.upsert.mockResolvedValue({});

    const result = await createAndOpenReturnFromFormData({
      orderNumber: "#1234",
      reason: "WRONG_SIZE",
      details: "Too small",
    }, { publicBaseUrl: "https://solution.resell-lausanne.ch" });

    expect(result).toMatchObject({
      success: true,
      returnId: "gid://shopify/Return/12",
      status: "OPEN",
      orderId: "gid://shopify/Order/1",
      returnTrackingNumber: "99.6000.1234.5678.90",
    });

    expect(prismaMock.marketplaceReturn.upsert).toHaveBeenCalledTimes(1);
    const upsertPayload = prismaMock.marketplaceReturn.upsert.mock.calls[0][0];
    expect(upsertPayload.where).toEqual({
      platform_externalReturnId: {
        platform: "shopify",
        externalReturnId: "gid://shopify/Return/12",
      },
    });
    expect(upsertPayload.create.returnAmount).toBe(200);
    expect(upsertPayload.create.currency).toBe("CHF");
    expect(upsertPayload.create.returnReasonCode).toBe("WRONG_SIZE");
    expect(upsertPayload.create.miraklStatus).toBe("OPEN");
    expect(upsertPayload.create.returnLabelNumber).toBe("99.6000.1234.5678.90");
    expect(upsertPayload.create.processStep).toBe("pending");
  });

  it("creates return for selected subset item quantity only", async () => {
    setupHappyPathGraphqlMocks();
    prismaMock.marketplaceReturn.upsert.mockResolvedValue({});

    await createAndOpenReturnFromFormData(
      {
        orderNumber: "#1234",
        reason: "WRONG_SIZE",
        details: "Only one pair",
        items: [
          {
            fulfillmentLineItemId: "gid://shopify/FulfillmentLineItem/77",
            quantity: 1,
          },
        ],
      },
      { publicBaseUrl: "https://solution.resell-lausanne.ch" }
    );

    const returnRequestCall = mockShopifyGraphQL.mock.calls.find((call) =>
      String(call[0]).includes("mutation ReturnRequestCreate")
    );
    expect(returnRequestCall?.[1]?.input?.returnLineItems?.[0]?.quantity).toBe(1);

    const upsertPayload = prismaMock.marketplaceReturn.upsert.mock.calls[0][0];
    expect(upsertPayload.create.returnAmount).toBe(100);
    expect(upsertPayload.create.quantity).toBe(1);
  });

  it("throws ITEM_NOT_RETURNABLE when selected item does not match order returnable lines", async () => {
    setupHappyPathGraphqlMocks();
    await expect(
      createAndOpenReturnFromFormData(
        {
          orderNumber: "#1234",
          reason: "OTHER",
          details: "Unknown line",
          items: [
            {
              fulfillmentLineItemId: "gid://shopify/FulfillmentLineItem/99999",
              quantity: 1,
            },
          ],
        },
        { publicBaseUrl: "https://solution.resell-lausanne.ch" }
      )
    ).rejects.toMatchObject({ code: "ITEM_NOT_RETURNABLE" });
  });

  it("throws SHOPIFY_USER_ERROR when returnRequest returns userErrors", async () => {
    mockShopifyGraphQL.mockImplementation(async (query: string) => {
      if (query.includes("query OrderLookupForReturn")) {
        return {
          data: {
            orders: {
              edges: [
                {
                  node: {
                    id: "gid://shopify/Order/1",
                    name: "#1234",
                    email: "customer@example.com",
                    customer: {
                      id: "gid://shopify/Customer/1",
                      email: "customer@example.com",
                      defaultEmailAddress: { emailAddress: "customer@example.com" },
                    },
                  },
                },
              ],
            },
          },
        };
      }
      if (query.includes("query ReturnableFulfillmentsForOrder")) {
        return {
          data: {
            returnableFulfillments: {
              edges: [
                {
                  node: {
                    returnableFulfillmentLineItems: {
                      edges: [
                        {
                          node: {
                            quantity: 1,
                            fulfillmentLineItem: {
                              id: "gid://shopify/FulfillmentLineItem/7",
                              lineItem: {
                                id: "gid://shopify/LineItem/1",
                                title: "Item",
                                sku: "SKU",
                                originalUnitPriceSet: {
                                  shopMoney: {
                                    amount: "10.00",
                                    currencyCode: "CHF",
                                  },
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
        };
      }
      if (query.includes("mutation ReturnRequestCreate")) {
        return {
          data: {
            returnRequest: {
              return: null,
              userErrors: [{ code: "INVALID", message: "Invalid return" }],
            },
          },
        };
      }
      throw new Error("Unexpected query");
    });

    await expect(
      createAndOpenReturnFromFormData({
        orderNumber: "#1234",
        email: "customer@example.com",
        reason: "OTHER",
        details: "Details",
      })
    ).rejects.toSatisfy((error: unknown) => {
      return (
        error instanceof ShopifyReturnRequestError &&
        error.code === "SHOPIFY_USER_ERROR"
      );
    });
  });
});
