import { describe, expect, it } from "vitest";
import {
  chooseGalaxusDesiredLane,
  GALAXUS_BUY_STANDARD_MAX_RATIO_OF_EXPRESS_DEFAULT,
  readGalaxusBuyStandardMaxRatioOfExpress,
} from "@/lib/stockxAutoCheckout/galaxusLanePolicy";

describe("readGalaxusBuyStandardMaxRatioOfExpress", () => {
  it("defaults to 0.5", () => {
    expect(readGalaxusBuyStandardMaxRatioOfExpress(undefined)).toBe(
      GALAXUS_BUY_STANDARD_MAX_RATIO_OF_EXPRESS_DEFAULT
    );
    expect(readGalaxusBuyStandardMaxRatioOfExpress("")).toBe(0.5);
  });

  it("accepts valid env override", () => {
    expect(readGalaxusBuyStandardMaxRatioOfExpress("0.4")).toBe(0.4);
  });

  it("rejects invalid env → default", () => {
    expect(readGalaxusBuyStandardMaxRatioOfExpress("nope")).toBe(0.5);
    expect(readGalaxusBuyStandardMaxRatioOfExpress("0")).toBe(0.5);
    expect(readGalaxusBuyStandardMaxRatioOfExpress("1.5")).toBe(0.5);
  });
});

describe("chooseGalaxusDesiredLane", () => {
  it("missing both → null", () => {
    expect(chooseGalaxusDesiredLane(null, null)).toBeNull();
    expect(chooseGalaxusDesiredLane(undefined, undefined)).toBeNull();
    expect(chooseGalaxusDesiredLane(0, -1)).toBeNull();
  });

  it("only express → EXPRESS", () => {
    expect(chooseGalaxusDesiredLane(120, null)).toBe("EXPRESS");
  });

  it("only standard → STANDARD", () => {
    expect(chooseGalaxusDesiredLane(null, 90)).toBe("STANDARD");
  });

  it("equal prices → EXPRESS (not half)", () => {
    expect(chooseGalaxusDesiredLane(100, 100)).toBe("EXPRESS");
  });

  it("standard at 49% of express → STANDARD", () => {
    expect(chooseGalaxusDesiredLane(100, 49)).toBe("STANDARD");
  });

  it("standard at exactly 50% → STANDARD (≤ threshold)", () => {
    expect(chooseGalaxusDesiredLane(100, 50)).toBe("STANDARD");
  });

  it("standard at 51% of express → EXPRESS", () => {
    expect(chooseGalaxusDesiredLane(100, 51)).toBe("EXPRESS");
  });

  it("respects custom threshold", () => {
    expect(chooseGalaxusDesiredLane(100, 60, 0.5)).toBe("EXPRESS");
    expect(chooseGalaxusDesiredLane(100, 60, 0.7)).toBe("STANDARD");
  });

  it("live example: Converse express 252 / standard 113 → STANDARD", () => {
    expect(chooseGalaxusDesiredLane(252.36, 112.95)).toBe("STANDARD");
  });

  it("modest gap → EXPRESS", () => {
    expect(chooseGalaxusDesiredLane(128.44, 125.12)).toBe("EXPRESS");
  });
});
