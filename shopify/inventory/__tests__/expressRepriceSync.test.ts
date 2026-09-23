import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedGraphQL = vi.hoisted(() => vi.fn());
const mockedQueryRaw = vi.hoisted(() => vi.fn());

vi.mock("@/lib/shopifyAdmin", () => ({
  shopifyGraphQL: mockedGraphQL,
}));

vi.mock("@/app/lib/prisma", () => ({
  prisma: { $queryRaw: mockedQueryRaw },
}));

import {
  processProductsUpdatePayload,
  type ProductsUpdatePayload,
} from "@/shopify/inventory/expressRepriceSync";

const V1 = "gid://shopify/ProductVariant/1";
const V2 = "gid://shopify/ProductVariant/2";

function nodesResponse(nodes: unknown[]) {
  return { data: { nodes }, errors: undefined };
}

/** Physical qty rows returned by the mirror query. */
function physicalRows(map: Record<string, number>) {
  return Object.entries(map).map(([variant_id, qty]) => ({ variant_id, qty }));
}

describe("processProductsUpdatePayload (express reprice sync)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets express_available=true when physical > 0 and leaves valid express_price", async () => {
    mockedGraphQL
      .mockResolvedValueOnce(
        nodesResponse([
          {
            id: V1,
            price: "200.00",
            barcode: "0196",
            expressAvailable: { value: "false" },
            expressPrice: { value: JSON.stringify({ amount: "220.00", currency_code: "CHF" }) },
          },
        ])
      )
      .mockResolvedValueOnce({ data: { metafieldsSet: { userErrors: [] } } });
    mockedQueryRaw.mockResolvedValueOnce(physicalRows({ [V1]: 2 }));

    const payload: ProductsUpdatePayload = {
      admin_graphql_api_id: "gid://shopify/Product/10",
      variants: [{ id: 1, price: "200.00", barcode: "0196" }],
    };
    const res = await processProductsUpdatePayload(payload);

    expect(res.changed).toHaveLength(1);
    expect(res.changed[0].expressAvailable).toEqual({ from: false, to: true });
    expect(res.changed[0].expressPrice).toBeUndefined(); // 220 >= 200 → untouched

    const setCall = mockedGraphQL.mock.calls.find((c) => String(c[0]).includes("metafieldsSet"));
    expect(setCall?.[1]?.metafields).toEqual([
      {
        ownerId: V1,
        namespace: "custom",
        key: "express_available",
        type: "boolean",
        value: "true",
      },
    ]);
  });

  it("raises stale express_price back over the current price after a reprice up", async () => {
    mockedGraphQL
      .mockResolvedValueOnce(
        nodesResponse([
          {
            id: V1,
            price: "260.00",
            barcode: null,
            expressAvailable: { value: "false" },
            expressPrice: { value: JSON.stringify({ amount: "220.00", currency_code: "CHF" }) },
          },
        ])
      )
      .mockResolvedValueOnce({ data: { metafieldsSet: { userErrors: [] } } });
    mockedQueryRaw.mockResolvedValueOnce(physicalRows({ [V1]: 0 }));

    const res = await processProductsUpdatePayload({
      admin_graphql_api_id: "gid://shopify/Product/10",
      variants: [{ admin_graphql_api_id: V1, price: "260.00" }],
    });

    expect(res.changed).toHaveLength(1);
    // 260 + 20 surcharge, ceil whole franc = 280
    expect(res.changed[0].expressPrice).toEqual({ from: 220, to: 280 });
    expect(res.changed[0].expressAvailable).toBeUndefined(); // already false, physical 0

    const setCall = mockedGraphQL.mock.calls.find((c) => String(c[0]).includes("metafieldsSet"));
    expect(setCall?.[1]?.metafields?.[0]).toMatchObject({
      ownerId: V1,
      key: "express_price",
      type: "money",
    });
    expect(JSON.parse(setCall?.[1]?.metafields?.[0]?.value)).toEqual({
      amount: "280.00",
      currency_code: "CHF",
    });
  });

  it("no writes when already consistent (idempotent, loop-safe)", async () => {
    mockedGraphQL.mockResolvedValueOnce(
      nodesResponse([
        {
          id: V1,
          price: "200.00",
          barcode: null,
          expressAvailable: { value: "true" },
          expressPrice: { value: JSON.stringify({ amount: "220.00", currency_code: "CHF" }) },
        },
      ])
    );
    mockedQueryRaw.mockResolvedValueOnce(physicalRows({ [V1]: 3 }));

    const res = await processProductsUpdatePayload({
      admin_graphql_api_id: "gid://shopify/Product/10",
      variants: [{ id: 1 }],
    });

    expect(res.changed).toHaveLength(0);
    expect(mockedGraphQL.mock.calls.some((c) => String(c[0]).includes("metafieldsSet"))).toBe(false);
  });

  it("never creates express_price when absent (StockX lane owns creation)", async () => {
    mockedGraphQL.mockResolvedValueOnce(
      nodesResponse([
        {
          id: V1,
          price: "260.00",
          barcode: null,
          expressAvailable: { value: "false" },
          expressPrice: null,
        },
      ])
    );
    mockedQueryRaw.mockResolvedValueOnce(physicalRows({ [V1]: 0 }));

    const res = await processProductsUpdatePayload({
      admin_graphql_api_id: "gid://shopify/Product/10",
      variants: [{ id: 1 }],
    });

    expect(res.changed).toHaveLength(0);
    expect(mockedGraphQL.mock.calls.some((c) => String(c[0]).includes("metafieldsSet"))).toBe(false);
  });

  it("batches multiple variant changes into one metafieldsSet", async () => {
    mockedGraphQL
      .mockResolvedValueOnce(
        nodesResponse([
          {
            id: V1,
            price: "200.00",
            barcode: null,
            expressAvailable: { value: "false" },
            expressPrice: null,
          },
          {
            id: V2,
            price: "300.00",
            barcode: null,
            expressAvailable: { value: "true" },
            expressPrice: { value: JSON.stringify({ amount: "250.00", currency_code: "CHF" }) },
          },
        ])
      )
      .mockResolvedValueOnce({ data: { metafieldsSet: { userErrors: [] } } });
    mockedQueryRaw.mockResolvedValueOnce(physicalRows({ [V1]: 1, [V2]: 0 }));

    const res = await processProductsUpdatePayload({
      admin_graphql_api_id: "gid://shopify/Product/10",
      variants: [{ id: 1 }, { id: 2 }],
    });

    expect(res.changed).toHaveLength(2);
    const setCalls = mockedGraphQL.mock.calls.filter((c) => String(c[0]).includes("metafieldsSet"));
    expect(setCalls).toHaveLength(1);
    // V1 express_available=true, V2 express_available=false + express_price raise (300+20=320)
    expect(setCalls[0][1].metafields).toHaveLength(3);
  });
});
