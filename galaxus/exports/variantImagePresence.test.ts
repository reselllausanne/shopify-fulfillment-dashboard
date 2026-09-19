import { describe, expect, it } from "vitest";
import {
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
