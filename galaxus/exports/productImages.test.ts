import { describe, expect, it } from "vitest";
import {
  pickGalaxusProductImageList,
  upgradeGalaxusImageResolution,
} from "@/galaxus/exports/productImages";

const STOCKX_THUMB =
  "https://images.stockx.com/images/Nike-Kyrie-4-Pitch-Blue-Product.jpg?fit=fill&bg=FFFFFF&w=140&h=100&fm=jpg&auto=compress&q=90&dpr=2";

describe("upgradeGalaxusImageResolution", () => {
  it("scales StockX thumbnails to at least 1200px on the long edge", () => {
    const upgraded = new URL(upgradeGalaxusImageResolution(STOCKX_THUMB));
    expect(upgraded.searchParams.get("w")).toBe("1200");
    expect(upgraded.searchParams.get("h")).toBe("857");
    expect(upgraded.searchParams.get("dpr")).toBeNull();
    expect(upgraded.searchParams.get("fm")).toBe("jpg");
  });

  it("leaves already-large images untouched", () => {
    const large = "https://images.stockx.com/images/x.jpg?w=1600&h=1200";
    expect(upgradeGalaxusImageResolution(large)).toBe(large);
  });

  it("leaves non-imgix hosts untouched", () => {
    const hosted = "https://cdn.resell-lausanne.ch/images/x.jpg?w=140&h=100";
    expect(upgradeGalaxusImageResolution(hosted)).toBe(hosted);
  });

  it("leaves URLs without size params untouched", () => {
    const plain = "https://images.stockx.com/images/x.jpg?fm=jpg";
    expect(upgradeGalaxusImageResolution(plain)).toBe(plain);
  });

  it("applies inside the export image picker", () => {
    const [main] = pickGalaxusProductImageList({ images: [STOCKX_THUMB] });
    expect(main).toContain("w=1200");
    expect(main).not.toContain("w=140");
  });
});
