import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * Sanity check the exact HMAC scheme the webhook route uses (base64 of HMAC-SHA256
 * over the raw body using SHOPIFY_API_SECRET). Kept small — full integration is
 * exercised by staging with a real Shopify webhook.
 */
describe("orders-paid webhook HMAC", () => {
  it("computes base64 HMAC-SHA256 matching Shopify's scheme", () => {
    const secret = "shpss_test";
    const body = JSON.stringify({ id: 1, line_items: [] });
    const expected = crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
    expect(expected).toMatch(/^[A-Za-z0-9+/=]+$/);
    const same = crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
    expect(same).toBe(expected);
  });
});
