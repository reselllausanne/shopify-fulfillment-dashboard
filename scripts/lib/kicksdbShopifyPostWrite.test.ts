import { describe, expect, it } from "vitest";

import {
  evaluatePostWriteVerification,
  urlMatchLoose,
} from "./kicksdbShopifyPostWrite";
import type { ProductMediaImage } from "./shopifyImageHeroRepair";

function media(id: string, url: string, width: number, height: number): ProductMediaImage {
  return { id, image: { url, width, height } };
}

describe("evaluatePostWriteVerification", () => {
  const stockx =
    "https://images.stockx.com/images/Puma-Future-5.jpg?fit=fill&w=1200&h=857&fm=jpg";
  const shopifyMatching =
    "https://cdn.shopify.com/s/files/1/0675/8324/6625/files/Puma-Future-5.jpg?v=1";
  const shopifyWrong =
    "https://cdn.shopify.com/s/files/1/0675/8324/6625/files/Completely-Unrelated-Hero.webp?v=1";

  it("fails upload_reorder when Shopify CDN does not match the expected StockX candidate", () => {
    // Old bug: after confirming featuredMediaId === expectedMediaId, the clause
    // `!view.media.some((m) => m.id === expectedMediaId)` was always false, so
    // URL mismatches were silently accepted. This test must fail with that logic.
    const featured = media("media-new", shopifyWrong, 1200, 900);
    const result = evaluatePostWriteVerification(
      {
        featuredMediaId: "media-new",
        featuredUrl: shopifyWrong,
        featuredWidth: 1200,
        featuredHeight: 900,
        media: [featured],
      },
      {
        expectedMediaId: "media-new",
        expectedSourceUrl: stockx,
        mode: "upload_reorder",
      }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("featured_url_mismatch");
      expect(result.expectedSourceUrl).toBe(stockx);
      expect(result.actualFeaturedUrl).toBe(shopifyWrong);
      expect(result.expectedMediaId).toBe("media-new");
      expect(result.actualFeaturedMediaId).toBe("media-new");
    }
  });

  it("passes upload_reorder when Shopify basename matches StockX candidate", () => {
    const featured = media("media-new", shopifyMatching, 1200, 900);
    expect(
      evaluatePostWriteVerification(
        {
          featuredMediaId: "media-new",
          featuredUrl: shopifyMatching,
          featuredWidth: 1200,
          featuredHeight: 900,
          media: [featured],
        },
        {
          expectedMediaId: "media-new",
          expectedSourceUrl: stockx,
          mode: "upload_reorder",
        }
      )
    ).toEqual({ ok: true, reason: "verified" });
  });

  it("reorder mode only requires featured id + dimensions (no StockX URL)", () => {
    const featured = media("hd", "https://cdn.shopify.com/gallery-hd.webp", 1400, 1000);
    const thumb = media("thumb", "https://cdn.shopify.com/thumb.webp", 280, 200);
    expect(
      evaluatePostWriteVerification(
        {
          featuredMediaId: "hd",
          featuredUrl: featured.image!.url,
          featuredWidth: 1400,
          featuredHeight: 1000,
          media: [thumb, featured],
        },
        {
          expectedMediaId: "hd",
          expectedSourceUrl: featured.image!.url,
          mode: "reorder",
        }
      )
    ).toEqual({ ok: true, reason: "verified" });
  });

  it("requires both width and height >= 500", () => {
    const featured = media("wide", "https://cdn.shopify.com/wide.webp", 1400, 300);
    const result = evaluatePostWriteVerification(
      {
        featuredMediaId: "wide",
        featuredUrl: featured.image!.url,
        featuredWidth: 1400,
        featuredHeight: 300,
        media: [featured],
      },
      {
        expectedMediaId: "wide",
        expectedSourceUrl: null,
        mode: "reorder",
      }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("featured_below_500_after_write");
  });

  it("urlMatchLoose matches StockX stem to Shopify CDN file", () => {
    expect(urlMatchLoose(shopifyMatching, stockx)).toBe(true);
    expect(urlMatchLoose(shopifyWrong, stockx)).toBe(false);
  });
});
