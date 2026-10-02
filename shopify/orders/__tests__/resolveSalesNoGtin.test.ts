import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/shopifyAdmin", () => ({
  shopifyGraphQL: vi.fn().mockResolvedValue({ data: { nodes: [] }, errors: null }),
}));

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    supplierVariant: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([]),
    shopifyPaidLineState: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));

import { resolveGtinSalesForLineItems } from "@/shopify/orders/ordersPaidConvergence";

describe("resolveGtinSalesForLineItems — no barcode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps sale lines that have variantId but no GTIN", async () => {
    const sales = await resolveGtinSalesForLineItems([
      {
        id: "999001",
        variant_id: "1234567890",
        sku: "7cd77591-15ee-470a-aaf8-46fd17b89763-OS",
        quantity: 1,
        price: "1549.00",
        barcode: null,
      },
    ]);
    expect(sales).toHaveLength(1);
    expect(sales[0]?.gtin).toBeNull();
    expect(sales[0]?.variantId).toBe("gid://shopify/ProductVariant/1234567890");
    expect(sales[0]?.sku).toBe("7cd77591-15ee-470a-aaf8-46fd17b89763-OS");
  });

  it("skips lines with neither GTIN nor variantId", async () => {
    const sales = await resolveGtinSalesForLineItems([
      {
        id: "1",
        variant_id: null,
        sku: null,
        quantity: 1,
        price: "0",
        barcode: null,
      },
    ]);
    expect(sales).toHaveLength(0);
  });
});
