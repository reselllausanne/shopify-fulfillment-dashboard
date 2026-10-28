import { describe, expect, it } from "vitest";
import {
  buildOpenOrdersSkuSearchQuery,
  lineSkuMatchesNeedles,
  preferSizedShopifySkus,
} from "@/lib/shopifyOpenOrdersBySku";

describe("preferSizedShopifySkus", () => {
  it("keeps only size-suffixed SKUs when present", () => {
    expect(
      preferSizedShopifySkus(["JR3733", "JR3733-41 1/3", "jr3733-38 2/3"])
    ).toEqual(["JR3733-41 1/3", "jr3733-38 2/3"]);
  });

  it("falls back to style SKUs when no size suffix exists", () => {
    expect(preferSizedShopifySkus(["JR3733", "ABC"])).toEqual(["JR3733", "ABC"]);
  });
});

describe("lineSkuMatchesNeedles", () => {
  it("matches sized needle to the same Shopify line SKU", () => {
    expect(lineSkuMatchesNeedles("JR3733-41 1/3", ["JR3733-41 1/3"])).toBe(true);
  });

  it("does not match other sizes when sized needles are present", () => {
    expect(lineSkuMatchesNeedles("JR3733-38 2/3", ["JR3733-41 1/3", "JR3733"])).toBe(
      false
    );
  });

  it("matches all sizes when only style SKU needles exist", () => {
    expect(lineSkuMatchesNeedles("JR3733-41 1/3", ["JR3733"])).toBe(true);
  });
});

describe("buildOpenOrdersSkuSearchQuery", () => {
  it("builds open-fulfillment query with sized sku token", () => {
    const q = buildOpenOrdersSkuSearchQuery({
      skus: ["JR3733-41 1/3"],
      minCreatedAt: new Date("2026-08-28T00:00:00.000Z"),
    });
    expect(q).toContain("fulfillment_status:unfulfilled");
    expect(q).toContain("-status:cancelled");
    expect(q).toContain("created:>=2026-08-28");
    expect(q).toContain("sku:JR3733-41 1/3");
    expect(q).not.toContain("sku:JR3733-41 1/3*");
  });

  it("uses prefix search for style-only SKU", () => {
    const q = buildOpenOrdersSkuSearchQuery({
      skus: ["JR3733"],
      minCreatedAt: new Date("2026-08-28T00:00:00.000Z"),
    });
    expect(q).toContain("sku:JR3733*");
  });
});
