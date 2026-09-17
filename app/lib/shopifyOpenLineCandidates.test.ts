import { describe, expect, it } from "vitest";
import { filterVerifiedOpenCandidates } from "@/app/lib/shopifyOpenLineCandidates";
import type { OpenShopifyLineCandidate } from "@/app/lib/shopifyAwbFallback";
import { resolveShopifyAwbFallbackMatch } from "@/app/lib/shopifyAwbFallback";

const PKG = {
  awb: "AWB1",
  sku: "STYLE-1",
  sizeEU: "42",
  productName: "Test Sneaker",
  purchaseDate: "2026-09-10T12:00:00.000Z",
};

function line(overrides: Partial<OpenShopifyLineCandidate>): OpenShopifyLineCandidate {
  return {
    shopifyOrderId: "gid://shopify/Order/1",
    shopifyOrderName: "#1000",
    shopifyLineItemId: "gid://shopify/LineItem/1",
    shopifySku: "STYLE-1",
    shopifySizeEU: "42",
    shopifyProductTitle: "Test Sneaker",
    shopifyCreatedAt: "2026-09-09T10:00:00.000Z",
    remainingQuantity: 1,
    ...overrides,
  };
}

describe("filterVerifiedOpenCandidates", () => {
  it("excludes fully fulfilled lines (remainingQuantity <= 0)", () => {
    const out = filterVerifiedOpenCandidates(PKG, [line({ remainingQuantity: 0 })]);
    expect(out).toHaveLength(0);
  });

  it("excludes cancelled/null awb hints by way of remainingQuantity=0", () => {
    // Simulated: fulfilled + null awb rows collapse to remainingQuantity 0.
    const out = filterVerifiedOpenCandidates(PKG, [
      line({ remainingQuantity: 0, shopifySku: "STYLE-1" }),
    ]);
    expect(out).toHaveLength(0);
  });

  it("keeps partially fulfilled lines with remainingQuantity > 0", () => {
    const out = filterVerifiedOpenCandidates(PKG, [
      line({ remainingQuantity: 1 }),
      line({
        shopifyLineItemId: "gid://shopify/LineItem/2",
        remainingQuantity: 2,
      }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("excludes lines with different SKU", () => {
    const out = filterVerifiedOpenCandidates(PKG, [
      line({ shopifySku: "OTHER-SKU" }),
    ]);
    expect(out).toHaveLength(0);
  });

  it("excludes lines whose order was created after StockX buy (causal fail)", () => {
    const out = filterVerifiedOpenCandidates(PKG, [
      line({ shopifyCreatedAt: "2026-09-11T00:00:00.000Z" }),
    ]);
    expect(out).toHaveLength(0);
  });
});

describe("resolveShopifyAwbFallbackMatch integration with verified pool", () => {
  it("returns exact for a single verified open line", () => {
    const out = resolveShopifyAwbFallbackMatch(PKG, [line({})]);
    expect(out.status).toBe("exact");
  });

  it("returns ambiguous for two verified open lines (FIFO on customer date)", () => {
    const out = resolveShopifyAwbFallbackMatch(PKG, [
      line({
        shopifyLineItemId: "gid://shopify/LineItem/A",
        shopifyCreatedAt: "2026-09-09T09:00:00.000Z",
      }),
      line({
        shopifyLineItemId: "gid://shopify/LineItem/B",
        shopifyCreatedAt: "2026-09-09T11:00:00.000Z",
      }),
    ]);
    expect(out.status).toBe("ambiguous");
    if (out.status === "ambiguous") {
      expect(out.candidates.map((c) => c.shopifyLineItemId)).toEqual([
        "gid://shopify/LineItem/A",
        "gid://shopify/LineItem/B",
      ]);
    }
  });

  it("returns none when the only candidate is cancelled/fully fulfilled", () => {
    const out = resolveShopifyAwbFallbackMatch(PKG, [line({ remainingQuantity: 0 })]);
    expect(out.status).toBe("none");
  });
});
