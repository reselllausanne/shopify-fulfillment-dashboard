import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { extractImageUrl } from "@/galaxus/kickdb/extract";
import {
  isGoogleCompliantKickdbUrl,
  isKickdbThumbnailUrl,
  resolveCanonicalKickdbImage,
  resolveCanonicalKickdbImageFromList,
  resolveCanonicalKickdbImageList,
} from "@/galaxus/kickdb/imageResolver";

const THUMB =
  "https://images.stockx.com/images/Air-Jordan-1.jpg?fit=fill&w=140&h=100&fm=jpg&dpr=2";
const HD =
  "https://images.stockx.com/images/Air-Jordan-1.jpg?fit=fill&w=1600&h=1200&fm=jpg";
const UNKNOWN = "https://cdn.example.com/plain.jpg";

describe("extractImageUrl (canonical pipeline)", () => {
  it("never returns a raw StockX thumbnail as the product hero", () => {
    const url = extractImageUrl({ image: THUMB, gallery: [THUMB] });
    expect(url).toBeTruthy();
    expect(isKickdbThumbnailUrl(url!)).toBe(false);
    expect(url).not.toContain("w=140");
  });

  it("prefers gallery HD over primary thumbnail", () => {
    expect(extractImageUrl({ image: THUMB, gallery: [HD] })).toBe(HD);
  });

  it("returns null when only a non-upgradable tiny image exists", () => {
    expect(extractImageUrl({ image: "https://cdn.example.com/x.jpg?w=80&h=60" })).toBeNull();
  });

  it("returns null for unknown-size-only payloads (no auto-accept)", () => {
    expect(extractImageUrl({ image: UNKNOWN })).toBeNull();
    expect(resolveCanonicalKickdbImage({ image: UNKNOWN }).reason).toBe(
      "IMAGE_DIMENSIONS_UNVERIFIED"
    );
  });
});

/** Mirrors galaxus/jobs/stxSync.ts stxVariantSyncPatch — price refresh must omit images. */
function stxVariantSyncPatch(row: {
  supplierVariantId: string;
  price: number;
  stock: number;
  deliveryType: string | null;
  images?: unknown;
}) {
  return {
    supplierVariantId: row.supplierVariantId,
    price: row.price,
    stock: row.stock,
    deliveryType: row.deliveryType,
  };
}

describe("price/stock update patch", () => {
  it("omits images so a refresh cannot rewrite a hero thumbnail", () => {
    const patch = stxVariantSyncPatch({
      supplierVariantId: "stx_1",
      price: 100,
      stock: 2,
      deliveryType: "express",
      images: [THUMB],
    });
    expect(patch).not.toHaveProperty("images");
    expect(Object.keys(patch).sort()).toEqual(
      ["deliveryType", "price", "stock", "supplierVariantId"].sort()
    );
  });
});

describe("write-path wiring (non-regression)", () => {
  const root = process.cwd();

  function read(rel: string): string {
    return readFileSync(path.join(root, rel), "utf8");
  }

  it("extract delegates to resolveCanonicalKickdbImage", () => {
    const src = read("galaxus/kickdb/extract.ts");
    expect(src).toContain('from "@/galaxus/kickdb/imageResolver"');
    expect(src).toContain("resolveCanonicalKickdbImage");
  });

  it("stxSync pickImages uses resolveCanonicalKickdbImageList", () => {
    const src = read("galaxus/jobs/stxSync.ts");
    expect(src).toContain("resolveCanonicalKickdbImageList");
    expect(src).toMatch(/function stxVariantSyncPatch[\s\S]*return \{[\s\S]*price:/);
    expect(src).not.toMatch(/function stxVariantSyncPatch[\s\S]*images:/);
  });

  it("imageSync resolveSourceImageUrl uses resolveCanonicalKickdbImageFromList", () => {
    const src = read("galaxus/jobs/imageSync.ts");
    expect(src).toContain("resolveCanonicalKickdbImageFromList");
  });

  it("physicalCatalogHydrate uses resolveCanonicalKickdbImageList", () => {
    const src = read("galaxus/jobs/physicalCatalogHydrate.ts");
    expect(src).toContain("resolveCanonicalKickdbImageList");
  });

  it("importProduct pickImages uses resolveCanonicalKickdbImageList", () => {
    const src = read("galaxus/stx/importProduct.ts");
    expect(src).toContain("resolveCanonicalKickdbImageList");
  });

  it("enrichJob never writes null imageUrl on update", () => {
    const src = read("galaxus/kickdb/enrichJob.ts");
    expect(src).toContain("...(imageUrl ? { imageUrl } : {})");
  });

  it("Python stockx_images rejects unknown size and upgrades thumbs", () => {
    const src = read("portable_product_upsert/stockx_images.py");
    expect(src).toContain("upgrade_kickdb_image_url");
    expect(src).toContain("is_google_compliant_kickdb_url");
    expect(src).toMatch(/if edge is None:\s+return False/);
  });
});

describe("null/rejected must not wipe a good hero decision", () => {
  it("resolver returns null instead of a rejected URL", () => {
    expect(resolveCanonicalKickdbImageList({ image: THUMB, gallery: [UNKNOWN] })[0]).not.toBe(
      UNKNOWN
    );
    expect(resolveCanonicalKickdbImageFromList([UNKNOWN, THUMB])).toBeTruthy();
    expect(isGoogleCompliantKickdbUrl(UNKNOWN)).toBe(false);
  });
});
