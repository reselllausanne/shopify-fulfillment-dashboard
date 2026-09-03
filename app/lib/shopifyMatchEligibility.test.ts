import { describe, expect, it } from "vitest";
import {
  isShopifyOrderMatchFresh,
  shopifyMatchMinCreatedAt,
  SHOPIFY_MATCH_MAX_AGE_MONTHS,
} from "@/app/lib/shopifyMatchEligibility";

describe("shopifyMatchEligibility", () => {
  it(`uses ${SHOPIFY_MATCH_MAX_AGE_MONTHS} month cutoff`, () => {
    const now = new Date("2026-09-01T12:00:00Z");
    const cutoff = shopifyMatchMinCreatedAt(now);
    expect(cutoff.toISOString().startsWith("2026-07-01")).toBe(true);
  });

  it("rejects null / ancient / accepts recent", () => {
    const now = new Date("2026-09-01T12:00:00Z");
    expect(isShopifyOrderMatchFresh(null, now)).toBe(false);
    expect(isShopifyOrderMatchFresh(new Date("2026-05-01T00:00:00Z"), now)).toBe(false);
    expect(isShopifyOrderMatchFresh(new Date("2026-08-15T00:00:00Z"), now)).toBe(true);
  });
});
