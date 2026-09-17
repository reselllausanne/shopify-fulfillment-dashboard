import { describe, expect, it } from "vitest";
import { extractImageUrl } from "@/galaxus/kickdb/extract";
import { isKickdbThumbnailUrl } from "@/galaxus/kickdb/imageResolver";

const THUMB =
  "https://images.stockx.com/images/Air-Jordan-1.jpg?fit=fill&w=140&h=100&fm=jpg&dpr=2";
const HD =
  "https://images.stockx.com/images/Air-Jordan-1.jpg?fit=fill&w=1600&h=1200&fm=jpg";

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
