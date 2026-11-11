import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedGraphQL = vi.hoisted(() => vi.fn());

vi.mock("@/lib/shopifyAdmin", () => ({ shopifyGraphQL: mockedGraphQL }));

import {
  syncProductSoldes48hMetafield,
  reconcileProductSoldes48hMetafields,
} from "@/shopify/inventory/productSoldes48hMetafield";

const PID = "gid://shopify/Product/10";

type VariantFixture = {
  delivery?: string | null;
  price?: string;
  compare?: string | null;
};

function productState(
  soldes: string | null,
  variants: VariantFixture[],
  tags: string[] = []
) {
  return {
    data: {
      product: {
        tags,
        soldes: soldes == null ? null : { value: soldes },
        variants: {
          nodes: variants.map((v) => ({
            price: v.price ?? "100.00",
            compareAtPrice: v.compare === undefined ? null : v.compare,
            delivery48h: v.delivery == null ? null : { value: v.delivery },
          })),
        },
      },
    },
    errors: undefined,
  };
}

describe("syncProductSoldes48hMetafield", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears soldes_48h when reprice drops the reduction, even if delivery_48h stays", async () => {
    mockedGraphQL
      .mockResolvedValueOnce(
        productState("true", [{ delivery: "true", price: "129.00", compare: null }], ["soldes-48h"])
      )
      .mockResolvedValueOnce({ data: { metafieldsSet: { userErrors: [] } } })
      .mockResolvedValueOnce({ data: { tagsRemove: { userErrors: [] } } });
    const changes: string[] = [];
    await syncProductSoldes48hMetafield(PID, changes);
    expect(changes).toEqual([
      "Shopify product soldes_48h=false (warehouse sale compare-at)",
      "Shopify tag soldes-48h removed",
    ]);
    const setCall = mockedGraphQL.mock.calls.find((c) => String(c[0]).includes("metafieldsSet"));
    expect(setCall?.[1]?.metafields?.[0]).toMatchObject({
      ownerId: PID,
      namespace: "custom",
      key: "soldes_48h",
      type: "boolean",
      value: "false",
    });
    const tagCall = mockedGraphQL.mock.calls.find((c) => String(c[0]).includes("tagsRemove"));
    expect(tagCall?.[1]).toMatchObject({ id: PID, tags: ["soldes-48h"] });
  });

  it("clears soldes_48h when no variant is on delivery_48h (sold out)", async () => {
    mockedGraphQL
      .mockResolvedValueOnce(
        productState("true", [
          { delivery: null, price: "90.00", compare: "140.00" },
          { delivery: "false", price: "90.00", compare: "140.00" },
        ])
      )
      .mockResolvedValueOnce({ data: { metafieldsSet: { userErrors: [] } } });
    const changes: string[] = [];
    await syncProductSoldes48hMetafield(PID, changes);
    expect(changes).toEqual(["Shopify product soldes_48h=false (warehouse sale compare-at)"]);
  });

  it("sets soldes_48h=true when an in-stock warehouse size is really discounted", async () => {
    mockedGraphQL
      .mockResolvedValueOnce(
        productState("false", [
          { delivery: "false", price: "90.00", compare: "90.00" },
          { delivery: "true", price: "90.00", compare: "140.00" },
        ])
      )
      .mockResolvedValueOnce({ data: { metafieldsSet: { userErrors: [] } } });
    const changes: string[] = [];
    await syncProductSoldes48hMetafield(PID, changes);
    expect(changes).toEqual(["Shopify product soldes_48h=true (warehouse sale compare-at)"]);
    const setCall = mockedGraphQL.mock.calls.find((c) => String(c[0]).includes("metafieldsSet"));
    expect(setCall?.[1]?.metafields?.[0]).toMatchObject({ value: "true" });
  });

  it("no write when already consistent (idempotent)", async () => {
    mockedGraphQL.mockResolvedValueOnce(
      productState("false", [{ delivery: null, price: "100.00", compare: null }])
    );
    const changes: string[] = [];
    await syncProductSoldes48hMetafield(PID, changes);
    expect(changes).toHaveLength(0);
    expect(mockedGraphQL.mock.calls.some((c) => String(c[0]).includes("metafieldsSet"))).toBe(false);
  });

  it("collects a warning instead of throwing on GraphQL error", async () => {
    mockedGraphQL.mockResolvedValueOnce({ data: null, errors: [{ message: "boom" }] });
    const warnings: string[] = [];
    await syncProductSoldes48hMetafield(PID, [], warnings);
    expect(warnings[0]).toContain("soldes_48h metafield failed");
  });
});

describe("reconcileProductSoldes48hMetafields", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears repriced in-stock products, keeps a size that is still discounted", async () => {
    mockedGraphQL.mockResolvedValueOnce({
      data: {
        products: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: "gid://shopify/Product/1",
              handle: "repriced-a",
              tags: ["soldes-48h"],
              soldes: { value: "true" },
              variants: {
                nodes: [
                  {
                    id: "gid://shopify/ProductVariant/11",
                    availableForSale: true,
                    price: "129.00",
                    compareAtPrice: null,
                  },
                ],
              },
            },
            {
              id: "gid://shopify/Product/2",
              handle: "live-b",
              tags: [],
              soldes: { value: "true" },
              variants: {
                nodes: [
                  {
                    id: "gid://shopify/ProductVariant/22",
                    availableForSale: true,
                    price: "90.00",
                    compareAtPrice: "140.00",
                  },
                ],
              },
            },
          ],
        },
      },
      errors: undefined,
    });

    const res = await reconcileProductSoldes48hMetafields({ dryRun: true });
    expect(res.scanned).toBe(2);
    expect(res.cleared).toBe(1);
    expect(res.sample).toEqual(["repriced-a"]);
    expect(mockedGraphQL.mock.calls.some((c) => String(c[0]).includes("metafieldsSet"))).toBe(false);
  });
});
