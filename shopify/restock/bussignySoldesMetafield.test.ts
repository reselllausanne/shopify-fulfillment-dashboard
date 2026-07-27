import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/shopifyAdmin", () => ({
  shopifyGraphQL: vi.fn(),
}));

import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { syncSoldes48hProductMetafield } from "@/shopify/restock/bussignySoldesMetafield";

const mockedQueryRaw = prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>;
const mockedGraphQL = shopifyGraphQL as unknown as ReturnType<typeof vi.fn>;

const PRODUCT_ID = "gid://shopify/Product/1";

function mockGraphQL(input: { soldes48h: boolean }) {
  mockedGraphQL.mockImplementation((query: string) => {
    if (query.includes("ProductSoldes48h")) {
      return Promise.resolve({
        data: {
          product: {
            soldes48h: { value: input.soldes48h ? "true" : "false" },
            variants: { nodes: [{ id: "gid://shopify/ProductVariant/1" }] },
          },
        },
      });
    }
    if (query.includes("metafieldDefinitions")) {
      return Promise.resolve({
        data: {
          metafieldDefinitions: { nodes: [{ id: "def-1", key: "soldes_48h" }] },
        },
      });
    }
    return Promise.resolve({ data: { metafieldsSet: { userErrors: [] } } });
  });
}

function metafieldsSetCalls() {
  return mockedGraphQL.mock.calls.filter(([query]) => String(query).includes("SetSoldes48h"));
}

describe("syncSoldes48hProductMetafield — gated on real liquidation lock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Bussigny stock WITHOUT manualLock (liquidation qty 0) → clears soldes_48h", async () => {
    mockGraphQL({ soldes48h: true });
    // bussignyLiquidationQtyForVariantIds: no locked stx row backs the stock.
    mockedQueryRaw.mockResolvedValue([{ available: 0 }]);

    const changes: string[] = [];
    const warnings: string[] = [];
    await syncSoldes48hProductMetafield(PRODUCT_ID, changes, warnings);

    expect(warnings).toEqual([]);
    const writes = metafieldsSetCalls();
    expect(writes).toHaveLength(1);
    expect(writes[0]![1]).toEqual(
      expect.objectContaining({
        metafields: [expect.objectContaining({ value: "false", key: "soldes_48h" })],
      })
    );
  });

  it("Bussigny stock WITH manualLock (liquidation qty > 0) → sets soldes_48h", async () => {
    mockGraphQL({ soldes48h: false });
    mockedQueryRaw.mockResolvedValue([{ available: 2 }]);

    const changes: string[] = [];
    const warnings: string[] = [];
    await syncSoldes48hProductMetafield(PRODUCT_ID, changes, warnings);

    expect(warnings).toEqual([]);
    const writes = metafieldsSetCalls();
    expect(writes).toHaveLength(1);
    expect(writes[0]![1]).toEqual(
      expect.objectContaining({
        metafields: [expect.objectContaining({ value: "true", key: "soldes_48h" })],
      })
    );
  });

  it("no-op when desired state already matches", async () => {
    mockGraphQL({ soldes48h: false });
    mockedQueryRaw.mockResolvedValue([{ available: 0 }]);

    const changes: string[] = [];
    const warnings: string[] = [];
    await syncSoldes48hProductMetafield(PRODUCT_ID, changes, warnings);

    expect(changes).toEqual([]);
    expect(metafieldsSetCalls()).toHaveLength(0);
  });
});
