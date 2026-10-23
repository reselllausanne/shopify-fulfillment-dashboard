import { describe, expect, it } from "vitest";
import {
  preferApiSettledOverUnitOcr,
  unitSettledLooksLikeOcrAboveApi,
} from "@/galaxus/stx/settledAmountPrefer";

describe("preferApiSettledOverUnitOcr", () => {
  it("keeps lower match/API when unit OCR is higher", () => {
    expect(preferApiSettledOverUnitOcr(135.27, 165.62)).toBe(135.27);
  });

  it("uses unit when match empty", () => {
    expect(preferApiSettledOverUnitOcr(null, 135.27)).toBe(135.27);
  });

  it("keeps existing when unit empty", () => {
    expect(preferApiSettledOverUnitOcr(135.27, null)).toBe(135.27);
  });

  it("allows unit when equal or lower than existing", () => {
    expect(preferApiSettledOverUnitOcr(165.62, 135.27)).toBe(135.27);
    expect(preferApiSettledOverUnitOcr(135.27, 135.27)).toBe(135.27);
  });
});

describe("unitSettledLooksLikeOcrAboveApi", () => {
  it("detects OCR above API", () => {
    expect(unitSettledLooksLikeOcrAboveApi(165.62, 135.27)).toBe(true);
  });

  it("false when aligned", () => {
    expect(unitSettledLooksLikeOcrAboveApi(135.27, 135.27)).toBe(false);
  });
});
