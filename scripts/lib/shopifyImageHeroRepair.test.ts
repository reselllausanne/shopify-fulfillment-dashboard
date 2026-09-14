import { describe, expect, it } from "vitest";

import {
  chooseHeroRepair,
  isGoogleReadyImage,
  isPlaceholderImage,
  type ProductMediaImage,
} from "./shopifyImageHeroRepair";

function media(id: string, url: string, width: number, height: number): ProductMediaImage {
  return { id, image: { url, width, height } };
}

describe("shopify image hero repair", () => {
  it("promotes an existing HD gallery image over a thumbnail", () => {
    const thumbnail = media("thumb", "https://cdn.shopify.com/thumb.webp", 280, 200);
    const hd = media("hd", "https://cdn.shopify.com/gallery.webp", 1400, 1000);

    expect(chooseHeroRepair([thumbnail, hd])).toEqual({
      action: "reorder",
      oldHero: thumbnail,
      newHero: hd,
    });
  });

  it("does not alter a valid hero", () => {
    expect(chooseHeroRepair([media("hero", "https://cdn.shopify.com/hero.webp", 800, 800)])).toEqual({
      action: "skip",
      reason: "hero_valid",
    });
  });

  it("rejects placeholders even when large", () => {
    const placeholder = media(
      "placeholder",
      "https://cdn.shopify.com/Product-Placeholder-Default.webp",
      1400,
      1000
    );
    expect(isPlaceholderImage(placeholder.image!.url)).toBe(true);
    expect(isGoogleReadyImage(placeholder)).toBe(false);
    expect(chooseHeroRepair([placeholder])).toEqual({
      action: "skip",
      reason: "no_valid_replacement",
    });
  });

  it("requires both dimensions to reach the minimum", () => {
    expect(isGoogleReadyImage(media("wide", "https://cdn.shopify.com/wide.webp", 1400, 300))).toBe(
      false
    );
  });
});
