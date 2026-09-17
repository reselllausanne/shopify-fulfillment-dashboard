import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import sharp from "sharp";
import {
  collectKickdbImageCandidates,
  declaredLongEdgePx,
  isGoogleCompliantKickdbUrl,
  isKickdbImageSizeUnknown,
  isKickdbThumbnailUrl,
  resolveCanonicalKickdbImage,
  resolveCanonicalKickdbImageFromList,
  resolveCanonicalKickdbImageList,
  resolveCanonicalKickdbImageVerified,
  upgradeKickdbImageUrl,
  verifyKickdbImageUrl,
} from "@/galaxus/kickdb/imageResolver";
import {
  clearImageDimensionCache,
  probeImageDimensions,
} from "@/galaxus/kickdb/imageDimensionProbe";

const THUMB =
  "https://images.stockx.com/images/Nike-Kyrie-4-Pitch-Blue-Product.jpg?fit=fill&bg=FFFFFF&w=140&h=100&fm=jpg&auto=compress&q=90&dpr=2";
const HD =
  "https://images.stockx.com/images/Nike-Kyrie-4-Pitch-Blue-Product.jpg?fit=fill&bg=FFFFFF&w=1400&h=1000&fm=jpg&auto=compress&q=90";
const PLAIN = "https://images.stockx.com/images/Nike-Kyrie-4-Pitch-Blue-Product.jpg?fm=jpg";

afterEach(() => {
  vi.restoreAllMocks();
  clearImageDimensionCache();
});

describe("isKickdbThumbnailUrl", () => {
  it("flags classic StockX 140×100 thumbs (even with dpr=2 → 280 edge)", () => {
    expect(isKickdbThumbnailUrl(THUMB)).toBe(true);
  });

  it("accepts declared HD", () => {
    expect(isKickdbThumbnailUrl(HD)).toBe(false);
  });

  it("does not treat unknown-size as thumbnail (handled as unverified)", () => {
    expect(isKickdbThumbnailUrl(PLAIN)).toBe(false);
    expect(isKickdbImageSizeUnknown(PLAIN)).toBe(true);
  });
});

describe("upgradeKickdbImageUrl", () => {
  it("scales thumbnail params to ≥1200 long edge", () => {
    const upgraded = new URL(upgradeKickdbImageUrl(THUMB));
    expect(Number(upgraded.searchParams.get("w"))).toBeGreaterThanOrEqual(1200);
    expect(upgraded.searchParams.get("dpr")).toBeNull();
  });
});

describe("isGoogleCompliantKickdbUrl", () => {
  it("rejects unknown size", () => {
    expect(isGoogleCompliantKickdbUrl(PLAIN)).toBe(false);
  });

  it("accepts declared HD", () => {
    expect(isGoogleCompliantKickdbUrl(HD)).toBe(true);
  });

  it("rejects raw thumbnail", () => {
    expect(isGoogleCompliantKickdbUrl(THUMB)).toBe(false);
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

  it("returns IMAGE_DIMENSIONS_UNVERIFIED for unknown-size-only payloads (sync)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = resolveCanonicalKickdbImage({ image: PLAIN });
    expect(result.url).toBeNull();
    expect(result.reason).toBe("IMAGE_DIMENSIONS_UNVERIFIED");
    expect(warn).toHaveBeenCalled();
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
  it("never places a thumbnail first and excludes unknown sizes", () => {
    const list = resolveCanonicalKickdbImageList({
      image: THUMB,
      gallery: [THUMB, HD, PLAIN],
    });
    expect(list[0]).toBe(HD);
    expect(list.every((url) => isGoogleCompliantKickdbUrl(url))).toBe(true);
    expect(list).not.toContain(PLAIN);
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

  it("returns null for unknown-size fallback (no auto-accept)", () => {
    const url = resolveCanonicalKickdbImageFromList([], { fallbackUrl: PLAIN });
    expect(url).toBeNull();
  });
});

async function jpegBuffer(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 200, b: 200 },
    },
  })
    .jpeg()
    .toBuffer();
}

describe("probeImageDimensions + verifyKickdbImageUrl", () => {
  beforeEach(() => {
    clearImageDimensionCache();
  });

  it("accepts thumbnail URL after declared upgrade without probe", async () => {
    const result = await verifyKickdbImageUrl(THUMB);
    expect(result.ok).toBe(true);
    expect(result.source).toBe("declared");
    expect(result.longEdge!).toBeGreaterThanOrEqual(500);
  });

  it("accepts declared HD without probe", async () => {
    const result = await verifyKickdbImageUrl(HD);
    expect(result.ok).toBe(true);
    expect(result.source).toBe("declared");
  });

  it("rejects unknown-size URL whose probed file is 300px", async () => {
    const buf = await jpegBuffer(300, 200);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(buf, { status: 200, headers: { "content-type": "image/jpeg" } })
      )
    );
    const probed = await probeImageDimensions("https://cdn.example.com/small.jpg");
    expect(probed.ok).toBe(false);
    expect(probed.longEdge).toBe(300);
    expect(probed.reason).toBe("probed_too_small");

    const verified = await verifyKickdbImageUrl("https://cdn.example.com/small.jpg");
    expect(verified.ok).toBe(false);
  });

  it("accepts unknown-size URL whose probed file is 1200px", async () => {
    const buf = await jpegBuffer(1200, 900);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(buf, { status: 200, headers: { "content-type": "image/jpeg" } })
      )
    );
    const verified = await verifyKickdbImageUrl("https://cdn.example.com/large.jpg");
    expect(verified.ok).toBe(true);
    expect(verified.source).toBe("probed");
    expect(verified.longEdge).toBe(1200);

    const resolved = await resolveCanonicalKickdbImageVerified({
      image: "https://cdn.example.com/large.jpg",
    });
    expect(resolved.reason).toBe("ok");
    expect(resolved.url).toBe("https://cdn.example.com/large.jpg");
    expect(resolved.verifiedLongEdge).toBe(1200);
  });

  it("marks inaccessible/timeout as IMAGE_DIMENSIONS_UNVERIFIED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      })
    );
    const probed = await probeImageDimensions("https://cdn.example.com/timeout.jpg", {
      timeoutMs: 50,
    });
    expect(probed.ok).toBe(false);
    expect(["timeout", "IMAGE_DIMENSIONS_UNVERIFIED"]).toContain(probed.reason);

    const resolved = await resolveCanonicalKickdbImageVerified({
      image: "https://cdn.example.com/timeout.jpg",
    });
    expect(resolved.url).toBeNull();
    expect(resolved.reason).toBe("IMAGE_DIMENSIONS_UNVERIFIED");
  });
});
