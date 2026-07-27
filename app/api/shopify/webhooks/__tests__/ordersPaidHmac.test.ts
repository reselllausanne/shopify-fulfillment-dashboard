import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyShopifyWebhookHmac } from "@/shopify/orders/ordersPaidConvergence";

describe("orders-paid webhook HMAC", () => {
  it("computes base64 HMAC-SHA256 matching Shopify's scheme", () => {
    const secret = "shpss_test";
    const body = JSON.stringify({ id: 1, line_items: [] });
    const raw = Buffer.from(body, "utf8");
    const expected = crypto.createHmac("sha256", secret).update(raw).digest("base64");
    expect(expected).toMatch(/^[A-Za-z0-9+/=]+$/);

    const prev = process.env.SHOPIFY_API_SECRET;
    process.env.SHOPIFY_API_SECRET = secret;
    try {
      expect(verifyShopifyWebhookHmac(raw, expected)).toBe(true);
      expect(verifyShopifyWebhookHmac(raw, "bad-signature")).toBe(false);
    } finally {
      process.env.SHOPIFY_API_SECRET = prev;
    }
  });
});
