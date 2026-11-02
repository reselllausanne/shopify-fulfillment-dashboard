import { describe, expect, it } from "vitest";
import {
  classifySlugMissingOutcome,
  isClearlyNotStockxBuyable,
  isStockxPlausibleWithoutSlug,
} from "@/lib/stockxAutoCheckout/nonStockxBuyable";

describe("classifySlugMissingOutcome", () => {
  it("#7568 Audemars × Travis Watch Face Tee → skipped (not on StockX)", () => {
    const title = "Travis Scott CJ x Audemars Piguet Watch Face Tee Green";
    expect(classifySlugMissingOutcome({ title })).toBe("skipped");
    expect(isClearlyNotStockxBuyable({ title }).label).toMatch(/watch_face|audemars|fixed_price/);
  });

  it("#7598 Nike Everyday Plus Cushioned Crew Socks → skipped", () => {
    const title = "Nike Everyday Plus Cushioned Crew Socks";
    expect(classifySlugMissingOutcome({ title })).toBe("skipped");
    expect(isClearlyNotStockxBuyable({ title }).notBuyable).toBe(true);
  });

  it("#7630 Topps NBA Hoops Hobby Box → needs_human (StockX-plausible)", () => {
    const title = "2026 Topps NBA Hoops Basketball Hobby Box";
    expect(isStockxPlausibleWithoutSlug({ title })).toBe(true);
    expect(classifySlugMissingOutcome({ title })).toBe("needs_human");
  });

  it("sneakers without slug stay needs_human", () => {
    expect(classifySlugMissingOutcome({ title: "Nike Dunk Low Panda" })).toBe("needs_human");
    expect(classifySlugMissingOutcome({ title: "Adidas Handball Spezial Fox Brown" })).toBe(
      "needs_human"
    );
  });

  it("excluded brands skip even without pattern match", () => {
    expect(classifySlugMissingOutcome({ title: "BAPE Shark Full Zip Hoodie" })).toBe("skipped");
    expect(classifySlugMissingOutcome({ title: "Crocs Classic Clog Black" })).toBe("skipped");
  });

  it("unknown apparel without strong denylist stays needs_human", () => {
    expect(classifySlugMissingOutcome({ title: "Some Random Collab Graphic Tee Black" })).toBe(
      "needs_human"
    );
  });
});
