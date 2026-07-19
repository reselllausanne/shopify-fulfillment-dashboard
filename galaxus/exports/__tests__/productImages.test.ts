import { describe, expect, it } from "vitest";
import { pickGalaxusProductImageList, scoreGalaxusImageUrl } from "../productImages";

describe("pickGalaxusProductImageList", () => {
  it("prefers .jpg from images JSON over hosted .avif", () => {
    const jpg = "https://cdn.example.com/p/sneaker-0.jpg?v=1";
    const avif = "https://storage.example.com/the_1/main-v2.avif";
    const list = pickGalaxusProductImageList({
      images: [avif, jpg],
      hostedImageUrl: avif,
      sourceImageUrl: null,
    });
    expect(list[0]).toContain(".jpg");
    expect(list[0]).not.toContain(".avif");
  });

  it("prefers synced hosted jpeg over StockX webp in images JSON", () => {
    const stockx =
      "https://images.stockx.com/images/x.jpg?w=500&fm=webp";
    const hosted = "https://storage.example.com/the_1/main-v1.jpg";
    const list = pickGalaxusProductImageList({
      images: [stockx],
      hostedImageUrl: hosted,
      imageSyncStatus: "SYNCED",
    });
    expect(list[0]).toBe(hosted);
  });
});

describe("scoreGalaxusImageUrl", () => {
  it("ranks StockX jpg path + fm=webp below plain shopify jpg", () => {
    const stockx =
      "https://images.stockx.com/images/x.jpg?w=500&fm=webp";
    const shopify = "https://cdn.shopify.com/files/x-0.jpg?v=1";
    expect(scoreGalaxusImageUrl(shopify)).toBeGreaterThan(scoreGalaxusImageUrl(stockx));
  });
});
