import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { buildImageAlt, encodeHeroWebp, smallMediaIdsToDelete } from "./kickdbHeroWebp";
import type { ProductMediaImage } from "./shopifyImageHeroRepair";

function media(id: string, width: number, height: number): ProductMediaImage {
  return { id, image: { url: `https://cdn.shopify.com/${id}.webp`, width, height } };
}

describe("encodeHeroWebp", () => {
  it("turns a JPEG buffer into real WebP ≥500", async () => {
    const jpeg = await sharp({
      create: { width: 800, height: 857, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .jpeg()
      .toBuffer();
    const jpegMeta = await sharp(jpeg).metadata();
    expect(jpegMeta.format).toBe("jpeg");

    const encoded = await encodeHeroWebp(jpeg);
    expect(encoded.sourceFormat).toBe("jpeg");
    expect(encoded.width).toBe(800);
    expect(encoded.height).toBe(857);
    const out = await sharp(encoded.buffer).metadata();
    expect(out.format).toBe("webp");
  });

  it("rejects a tiny source even after webp encode", async () => {
    const jpeg = await sharp({
      create: { width: 280, height: 200, channels: 3, background: "#fff" },
    })
      .jpeg()
      .toBuffer();
    await expect(encodeHeroWebp(jpeg)).rejects.toThrow(/webp_below_500/);
  });
});

describe("buildImageAlt", () => {
  it("builds the same authentic alt shape as listing enrichment", () => {
    expect(buildImageAlt("Nike Dunk Low White", "Nike")).toBe(
      "Nike Dunk Low White - authentic Nike sneakers"
    );
  });
});

describe("smallMediaIdsToDelete", () => {
  it("drops only sub-500 media and never the new hero", () => {
    expect(
      smallMediaIdsToDelete(
        [media("old", 280, 200), media("hero", 800, 857), media("angle", 1200, 900)],
        "hero"
      )
    ).toEqual(["old"]);
  });
});
