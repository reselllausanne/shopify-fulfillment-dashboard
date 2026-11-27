import { describe, expect, it } from "vitest";
import { promoAccountForShopifyCheckout, shopifyStockxAccount, tokensForShopifyAutoLink } from "@/lib/stockxBuyer/shopifyStockxAccount";

describe("temporary Shopify StockX account", () => {
  it("defaults to the Shopify profile", () => {
    expect(shopifyStockxAccount({} as NodeJS.ProcessEnv)).toBe("default");
    expect(promoAccountForShopifyCheckout({} as NodeJS.ProcessEnv)).toBe("shopify");
  });

  it("switches checkout and promo to Galaxus when asked", () => {
    const env = { STOCKX_BUYER_SHOPIFY_ACCOUNT: "galaxus" } as NodeJS.ProcessEnv;
    expect(shopifyStockxAccount(env)).toBe("galaxus");
    expect(promoAccountForShopifyCheckout(env)).toBe("galaxus");
  });

  it("auto-link uses every account token unless a test token is forced", () => {
    expect(tokensForShopifyAutoLink("only", ["a", "b"])).toEqual(["only"]);
    expect(tokensForShopifyAutoLink(null, ["a", "a", "b"])).toEqual(["a", "b"]);
  });
});
