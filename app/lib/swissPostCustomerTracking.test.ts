import { describe, expect, it } from "vitest";
import {
  buildSwissPostTrackingUrl,
  looksLikeSwissPostIdent,
  resolveSwissPostCustomerTracking,
  shopifyOrderIdAliases,
  toShopifyOrderGid,
} from "@/app/lib/swissPostCustomerTracking";

describe("toShopifyOrderGid", () => {
  it("promotes a bare numeric id to the canonical GID", () => {
    expect(toShopifyOrderGid("13497769853314")).toBe("gid://shopify/Order/13497769853314");
    expect(toShopifyOrderGid(13497769853314)).toBe("gid://shopify/Order/13497769853314");
  });

  it("leaves an already canonical GID untouched", () => {
    expect(toShopifyOrderGid("gid://shopify/Order/123")).toBe("gid://shopify/Order/123");
  });

  it("returns an empty string for blank input", () => {
    expect(toShopifyOrderGid(null)).toBe("");
    expect(toShopifyOrderGid("   ")).toBe("");
  });
});

describe("swissPostCustomerTracking", () => {
  it("aliases numeric and gid order ids", () => {
    expect(shopifyOrderIdAliases("gid://shopify/Order/123")).toEqual([
      "gid://shopify/Order/123",
      "123",
    ]);
    expect(shopifyOrderIdAliases(123)).toEqual(["123", "gid://shopify/Order/123"]);
  });

  it("accepts Swiss Post ident and builds search url", () => {
    expect(looksLikeSwissPostIdent("99.01.234567")).toBe(true);
    expect(looksLikeSwissPostIdent("1Z999AA10123456784")).toBe(false);
    expect(buildSwissPostTrackingUrl("99.01.234567")).toContain("99.01.234567");
  });

  it("resolves outbound tracking from Shopify company + number", () => {
    const resolved = resolveSwissPostCustomerTracking({
      trackingNumber: "99.60.123456",
      trackingCompany: "La Poste",
    });
    expect(resolved?.trackingNumber).toBe("99.60.123456");
    expect(resolved?.trackingUrl).toContain("service.post.ch");
  });

  it("ignores StockX inbound AWB even if company says Swiss Post", () => {
    expect(
      resolveSwissPostCustomerTracking({
        trackingNumber: "1Z999AA10123456784",
        trackingCompany: "Swiss Post",
      })
    ).toBeNull();
  });
});
