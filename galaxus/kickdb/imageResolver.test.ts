import { describe, expect, it, vi, afterEach } from "vitest";
import {
  collectKickdbImageCandidates,
  declaredLongEdgePx,
  isGoogleCompliantKickdbUrl,
  isKickdbThumbnailUrl,
  resolveCanonicalKickdbImage,
  resolveCanonicalKickdbImageFromList,
  resolveCanonicalKickdbImageList,
  upgradeKickdbImageUrl,
} from "@/galaxus/kickdb/imageResolver";

const THUMB =
  "https://images.stockx.com/images/Nike-Kyrie-4-Pitch-Blue-Product.jpg?fit=fill&bg=FFFFFF&w=140&h=100&fm=jpg&auto=compress&q=90&dpr=2";
const HD =
  "https://images.stockx.com/images/Nike-Kyrie-4-Pitch-Blue-Product.jpg?fit=fill&bg=FFFFFF&w=1400&h=1000&fm=jpg&auto=compress&q=90";
const PLAIN = "https://images.stockx.com/images/Nike-Kyrie-4-Pitch-Blue-Product.jpg?fm=jpg";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isKickdbThumbnailUrl", () => {
  it("flags classic StockX 140×100 thumbs (even with dpr=2 → 280 edge)", () => {
    expect(isKickdbThumbnailUrl(THUMB)).toBe(true);
  });

  it("accepts declared HD", () => {
    expect(isKickdbThumbnailUrl(HD)).toBe(false);
  });

  it("does not reject unknown-size URLs", () => {
    expect(isKickdbThumbnailUrl(PLAIN)).toBe(false);
  });
});

describe("upgradeKickdbImageUrl", () => {
  it("scales thumbnail params to ≥1200 long edge", () => {
    const upgraded = new URL(upgradeKickdbImageUrl(THUMB));
    expect(Number(upgraded.searchParams.get("w"))).toBeGreaterThanOrEqual(1200);
    expect(upgraded.searchParams.get("dpr")).toBeNull();
  });
});

describe("resolveCanonicalKickdbImage", () => {
  it("upgrades a lone thumbnail into a Google-compliant hero", () => {
    const result = resolveCanonicalKickdbImage({ image: THUMB });
    expect(result.reason).toBe("ok");
    expect(result.thumbnailDetected).toBe(true);
    expect(result.url).toBeTruthy();
    expect(isKickdbThumbnailUrl(result.url!)).toBe(false);
    expect(isGoogleCompliantKickdbUrl(result.url!)).toBe(true);
    expect(declaredLongEdgePx(result.url!)!).toBeGreaterThanOrEqual(500);
  });

  it("prefers an existing HD gallery shot over a primary thumbnail", () => {
    const result = resolveCanonicalKickdbImage({
      image: THUMB,
      gallery: [THUMB, HD],
    });
    expect(result.url).toBe(HD);
    expect(result.thumbnailDetected).toBe(true);
  });

  it("returns null and logs when only non-upgradable tiny host remains", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tiny = "https://cdn.example.com/tiny.jpg?w=100&h=80";
    const result = resolveCanonicalKickdbImage(
      { image: tiny },
      { logContext: { kickdbProductId: "p1" } }
    );
    expect(result.url).toBeNull();
    expect(result.reason).toBe("no_compliant_after_filter");
    expect(warn).toHaveBeenCalled();
    const payload = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(payload.event).toBe("kickdb.image.no_compliant");
    expect(payload.kickdbProductId).toBe("p1");
  });

  it("returns null when payload has no images", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = resolveCanonicalKickdbImage({ title: "x" });
    expect(result.url).toBeNull();
    expect(result.reason).toBe("no_candidates");
    expect(warn).toHaveBeenCalled();
  });

  it("collects gallery_360 and media fields", () => {
    const urls = collectKickdbImageCandidates({
      media: { imageUrl: PLAIN },
      gallery_360: [HD],
    });
    expect(urls).toEqual([PLAIN, HD]);
  });
});

describe("resolveCanonicalKickdbImageList", () => {
  it("never places a thumbnail first", () => {
    const list = resolveCanonicalKickdbImageList({
      image: THUMB,
      gallery: [THUMB, HD, PLAIN],
    });
    expect(list[0]).toBe(HD);
    expect(list.every((url) => isGoogleCompliantKickdbUrl(url))).toBe(true);
  });
});

describe("resolveCanonicalKickdbImageFromList", () => {
  it("upgrades SupplierVariant.images[0] thumbnail instead of keeping it", () => {
    const url = resolveCanonicalKickdbImageFromList([THUMB, HD]);
    expect(url).toBe(HD);
  });

  it("falls back to sourceImageUrl when images empty", () => {
    const url = resolveCanonicalKickdbImageFromList([], { fallbackUrl: HD });
    expect(url).toBe(HD);
  });

  it("returns null rather than a non-compliant fallback", () => {
    const url = resolveCanonicalKickdbImageFromList([], {
      fallbackUrl: "https://cdn.example.com/x.jpg?w=120&h=90",
    });
    expect(url).toBeNull();
  });
});
