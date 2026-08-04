import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/shopifyAdmin", () => ({
  shopifyGraphQL: vi.fn(),
}));

import { prisma } from "@/app/lib/prisma";
import { syncPhysicalInStockMetafieldForProduct } from "@/shopify/inventory/physicalInStockMetafield";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";

function mockGraphql(handlers: {
  product?: Record<string, unknown>;
  onSet?: () => void;
  onDelete?: () => void;
}) {
  (shopifyGraphQL as any).mockImplementation(async (query: string) => {
    if (query.includes("ProductPhysicalInStock")) {
      return { data: { product: handlers.product } };
    }
    if (query.includes("PhysicalInStockDefinition")) {
      return {
        data: { metafieldDefinitions: { nodes: [{ id: "def1", key: "physical_in_stock" }] } },
      };
    }
    if (query.includes("metafieldsSet")) {
      handlers.onSet?.();
      return { data: { metafieldsSet: { userErrors: [] } } };
    }
    if (query.includes("metafieldsDelete")) {
      handlers.onDelete?.();
      return { data: { metafieldsDelete: { userErrors: [] } } };
    }
    return { data: {} };
  });
}

describe("syncPhysicalInStockMetafieldForProduct", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets physical_in_stock + Google custom_label_0 when mirror has physical qty", async () => {
    const sets: string[] = [];
    mockGraphql({
      product: {
        physicalInStock: { value: "false" },
        googleCustomLabel0: null,
        variants: { nodes: [{ id: "gid://shopify/ProductVariant/1" }] },
      },
      onSet: () => sets.push("set"),
    });
    (prisma.$queryRaw as any).mockResolvedValue([{ available: 2 }]);

    const changes: string[] = [];
    await syncPhysicalInStockMetafieldForProduct("gid://shopify/Product/1", changes);

    expect(changes.some((c) => c.includes("physical_in_stock=true"))).toBe(true);
    expect(changes.some((c) => c.includes("custom_label_0=in_store"))).toBe(true);
    expect(sets.length).toBe(2);
  });

  it("clears physical_in_stock + Google custom_label_0 when only dropship remains", async () => {
    let deleted = false;
    mockGraphql({
      product: {
        physicalInStock: { value: "true" },
        googleCustomLabel0: { id: "mf1", value: "in_store" },
        variants: { nodes: [{ id: "gid://shopify/ProductVariant/1" }] },
      },
      onDelete: () => {
        deleted = true;
      },
    });
    (prisma.$queryRaw as any).mockResolvedValue([{ available: 0 }]);

    const changes: string[] = [];
    await syncPhysicalInStockMetafieldForProduct("gid://shopify/Product/1", changes);

    expect(changes.some((c) => c.includes("physical_in_stock=false"))).toBe(true);
    expect(changes.some((c) => c.includes("custom_label_0 cleared"))).toBe(true);
    expect(deleted).toBe(true);
  });

  it("backfills Google custom_label_0 when physical_in_stock already true", async () => {
    const sets: string[] = [];
    mockGraphql({
      product: {
        physicalInStock: { value: "true" },
        googleCustomLabel0: null,
        variants: { nodes: [{ id: "gid://shopify/ProductVariant/1" }] },
      },
      onSet: () => sets.push("set"),
    });
    (prisma.$queryRaw as any).mockResolvedValue([{ available: 1 }]);

    const changes: string[] = [];
    await syncPhysicalInStockMetafieldForProduct("gid://shopify/Product/1", changes);

    expect(changes.some((c) => c.includes("physical_in_stock"))).toBe(false);
    expect(changes.some((c) => c.includes("custom_label_0=in_store"))).toBe(true);
    expect(sets.length).toBe(1);
  });

  it("does not clear unrelated custom_label_0 values", async () => {
    let deleted = false;
    mockGraphql({
      product: {
        physicalInStock: { value: "false" },
        googleCustomLabel0: { id: "mf1", value: "summer" },
        variants: { nodes: [{ id: "gid://shopify/ProductVariant/1" }] },
      },
      onDelete: () => {
        deleted = true;
      },
    });
    (prisma.$queryRaw as any).mockResolvedValue([{ available: 0 }]);

    const changes: string[] = [];
    await syncPhysicalInStockMetafieldForProduct("gid://shopify/Product/1", changes);

    expect(changes.some((c) => c.includes("custom_label_0 cleared"))).toBe(false);
    expect(deleted).toBe(false);
  });
});
