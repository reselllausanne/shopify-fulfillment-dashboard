import { describe, expect, it } from "vitest";
import { upgradeMailProductImageUrl } from "@/lib/stockxDelayRebuy/productImage";

describe("upgradeMailProductImageUrl", () => {
  it("bumps stockx/imgix w/h for email", () => {
    const out = upgradeMailProductImageUrl(
      "https://images.stockx.com/images/Nike-Air-Max-1-Obsidian-Product.jpg?fit=fill&bg=FFFFFF&w=140&h=100&fm=webp"
    );
    expect(out).toContain("w=800");
    expect(out).toContain("h=600");
    expect(out).toContain("fit=fill");
  });

  it("leaves non-stockx urls alone", () => {
    const u = "https://cdn.shopify.com/s/files/1/x/product.jpg";
    expect(upgradeMailProductImageUrl(u)).toBe(u);
  });
});
