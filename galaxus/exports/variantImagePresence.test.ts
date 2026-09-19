import { describe, expect, it } from "vitest";
import {
  attachHasImageSignalToMappings,
  hasAbsoluteImageUrl,
  hasGalaxusPrimaryImage,
} from "@/galaxus/exports/variantImagePresence";

describe("hasAbsoluteImageUrl", () => {
  it("accepts https hosted/source", () => {
    expect(hasAbsoluteImageUrl({ hostedImageUrl: "https://cdn.example.com/a.jpg" })).toBe(true);
    expect(hasAbsoluteImageUrl({ sourceImageUrl: "http://cdn.example.com/a.jpg" })).toBe(true);
  });

  it("rejects empty / relative", () => {
    expect(hasAbsoluteImageUrl({ hostedImageUrl: "" })).toBe(false);
    expect(hasAbsoluteImageUrl({ sourceImageUrl: "/local.jpg" })).toBe(false);
    expect(hasAbsoluteImageUrl({})).toBe(false);
  });
});

describe("hasGalaxusPrimaryImage", () => {
  it("honors hasImageSignal without images JSONB", () => {
    expect(hasGalaxusPrimaryImage({ hasImageSignal: true })).toBe(true);
    expect(hasGalaxusPrimaryImage({ hasImageSignal: false })).toBe(false);
  });

  it("falls back to pickGalaxusProductImageList when signal absent", () => {
    expect(
      hasGalaxusPrimaryImage({
        sourceImageUrl: "https://cdn.example.com/af1.jpg",
      })
    ).toBe(true);
    expect(hasGalaxusPrimaryImage({ images: null, sourceImageUrl: null })).toBe(false);
  });
});

describe("attachHasImageSignalToMappings", () => {
  it("matches pickGalaxus: absolute URL in images JSON, not mere non-empty JSON", async () => {
    const withHttp = {
      supplierVariant: {
        supplierVariantId: "a",
        images: ["https://cdn.example.com/x.jpg"],
        sourceImageUrl: null,
        hostedImageUrl: null,
      },
    };
    const emptyish = {
      supplierVariant: {
        supplierVariantId: "b",
        images: [{ caption: "no-url" }],
        sourceImageUrl: null,
        hostedImageUrl: null,
      },
    };
    await attachHasImageSignalToMappings([withHttp, emptyish]);
    expect(withHttp.supplierVariant.hasImageSignal).toBe(true);
    expect(emptyish.supplierVariant.hasImageSignal).toBe(false);
    expect("images" in withHttp.supplierVariant).toBe(false);
    expect("images" in emptyish.supplierVariant).toBe(false);
  });

  it("URL short-circuit true without needing images", async () => {
    const row = {
      supplierVariant: {
        supplierVariantId: "c",
        hostedImageUrl: "https://cdn.example.com/y.jpg",
      },
    };
    await attachHasImageSignalToMappings([row]);
    expect(row.supplierVariant.hasImageSignal).toBe(true);
  });
});
