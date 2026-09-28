import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedGraphQL = vi.hoisted(() => vi.fn());
const mockedQueryRaw = vi.hoisted(() => vi.fn());

vi.mock("@/lib/shopifyAdmin", () => ({ shopifyGraphQL: mockedGraphQL }));
vi.mock("@/app/lib/prisma", () => ({ prisma: { $queryRaw: mockedQueryRaw } }));

import {
  syncProductSoldes48hMetafield,
  reconcileProductSoldes48hMetafields,
} from "@/shopify/inventory/productSoldes48hMetafield";

const PID = "gid://shopify/Product/10";

function productState(soldes: string | null, delivery48hValues: Array<string | null>) {
  return {
    data: {
      product: {
        soldes: soldes == null ? null : { value: soldes },
        variants: { nodes: delivery48hValues.map((v) => ({ delivery48h: v == null ? null : { value: v } })) },
      },
    },
    errors: undefined,
  };
}

describe("syncProductSoldes48hMetafield", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears soldes_48h=true when no variant is on delivery_48h (sold out)", async () => {
    mockedGraphQL
      .mockResolvedValueOnce(productState("true", [null, "false", null]))
      .mockResolvedValueOnce({ data: { metafieldsSet: { userErrors: [] } } });
    const changes: string[] = [];
    await syncProductSoldes48hMetafield(PID, changes);
    expect(changes).toEqual(["Shopify product soldes_48h=false (any variant delivery_48h)"]);
    const setCall = mockedGraphQL.mock.calls.find((c) => String(c[0]).includes("metafieldsSet"));
    expect(setCall?.[1]?.metafields?.[0]).toMatchObject({
      ownerId: PID,
      namespace: "custom",
      key: "soldes_48h",
      type: "boolean",
      value: "false",
    });
  });

  it("sets soldes_48h=true when a variant is on delivery_48h", async () => {
    mockedGraphQL
      .mockResolvedValueOnce(productState("false", ["false", "true"]))
      .mockResolvedValueOnce({ data: { metafieldsSet: { userErrors: [] } } });
    const changes: string[] = [];
    await syncProductSoldes48hMetafield(PID, changes);
    expect(changes).toEqual(["Shopify product soldes_48h=true (any variant delivery_48h)"]);
  });

  it("no write when already consistent (idempotent)", async () => {
    mockedGraphQL.mockResolvedValueOnce(productState("false", [null, "false"]));
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

  it("clears stale trues (0 physical), keeps in-stock soldes, dry-run makes no writes", async () => {
    mockedGraphQL.mockResolvedValueOnce({
      data: {
        products: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            { id: "gid://shopify/Product/1", handle: "stale-a", soldes: { value: "true" }, variants: { nodes: [{ id: "gid://shopify/ProductVariant/11" }] } },
            { id: "gid://shopify/Product/2", handle: "live-b", soldes: { value: "true" }, variants: { nodes: [{ id: "gid://shopify/ProductVariant/22" }] } },
          ],
        },
      },
      errors: undefined,
    });
    // Product 1 → 0 physical (stale), Product 2 → 3 physical (keep)
    mockedQueryRaw
      .mockResolvedValueOnce([{ qty: 0 }])
      .mockResolvedValueOnce([{ qty: 3 }]);

    const res = await reconcileProductSoldes48hMetafields({ dryRun: true });
    expect(res.scanned).toBe(2);
    expect(res.cleared).toBe(1);
    expect(res.sample).toEqual(["stale-a"]);
    expect(mockedGraphQL.mock.calls.some((c) => String(c[0]).includes("metafieldsSet"))).toBe(false);
  });
});
