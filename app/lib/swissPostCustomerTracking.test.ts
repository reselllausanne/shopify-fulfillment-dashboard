import { describe, expect, it } from "vitest";
import {
  buildSwissPostTrackingUrl,
  looksLikeSwissPostIdent,
  resolveSwissPostCustomerTracking,
  shopifyOrderIdAliases,
} from "@/app/lib/swissPostCustomerTracking";

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
