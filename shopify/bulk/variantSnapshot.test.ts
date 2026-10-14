import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/shopifyAdmin", () => ({ shopifyGraphQL: vi.fn() }));

import {
  buildVariantSnapshotQuery,
  createVariantSnapshotCollector,
  groupSnapshotByProduct,
} from "./variantSnapshot";

describe("buildVariantSnapshotQuery", () => {
  it("only includes inventory when a location is given", () => {
    expect(buildVariantSnapshotQuery()).not.toContain("inventoryLevel");
    expect(buildVariantSnapshotQuery("gid://shopify/Location/1")).toContain(
      'inventoryLevel(locationId: "gid://shopify/Location/1")'
    );
  });
});

describe("createVariantSnapshotCollector", () => {
  it("folds child metafield lines into their variant, in any order", () => {
    const c = createVariantSnapshotCollector(["price_locked", "express_price"]);
    c.add({ key: "price_locked", value: "true", __parentId: "gid://shopify/ProductVariant/2" });
    c.add({ id: "gid://shopify/ProductVariant/1", price: "120.00", title: "42", barcode: "123", product: { id: "P1" } });
    c.add({ key: "express_price", value: '{"amount":"150.00"}', __parentId: "gid://shopify/ProductVariant/1" });
    c.add({ key: "ignored_key", value: "x", __parentId: "gid://shopify/ProductVariant/1" });
    c.add({
      id: "gid://shopify/ProductVariant/2",
      price: "99.00",
      title: "43",
      barcode: null,
      product: { id: "P1" },
      inventoryItem: { id: "I2", inventoryLevel: { quantities: [{ quantity: 1 }] } },
    });

    const v1 = c.result.get("gid://shopify/ProductVariant/1")!;
    expect(v1.metafields).toEqual({ express_price: '{"amount":"150.00"}' });
    expect(v1.available).toBeNull();
    const v2 = c.result.get("gid://shopify/ProductVariant/2")!;
    expect(v2.metafields).toEqual({ price_locked: "true" });
    expect(v2.available).toBe(1);
    expect(v2.inventoryItemId).toBe("I2");

    const grouped = groupSnapshotByProduct(c.result).get("P1")!;
    expect(grouped).toHaveLength(2);
    expect(grouped.find((n) => n.id.endsWith("/2"))?.priceLocked).toEqual({ value: "true" });
    expect(grouped.find((n) => n.id.endsWith("/1"))?.priceLocked).toBeNull();
  });
});
