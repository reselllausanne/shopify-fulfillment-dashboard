import { describe, expect, it } from "vitest";
import { matchSizeToPicked, normalizeStyleCode, pickValidGtinFromSize } from "@/lib/barcodesGg/gtinPick";

describe("pickValidGtinFromSize", () => {
  it("prefers valid UPC and pads to EAN-13", () => {
    const pick = pickValidGtinFromSize({
      eu: "40",
      us: "7",
      upc: "194502876000",
      ean: "garbage",
    });
    expect(pick?.source).toBe("upc");
    expect(pick?.gtin).toBe("0194502876000");
  });

  it("rejects bad check digit", () => {
    expect(pickValidGtinFromSize({ ean: "1234567890123", upc: "" })).toBeNull();
  });
});

describe("matchSizeToPicked", () => {
  const picks = [
    { gtin: "0194502876000", source: "upc" as const, eu: "40", us: "7" },
    { gtin: "0194502876017", source: "upc" as const, eu: "40.5", us: "7.5" },
  ];

  it("matches EU sizeRaw", () => {
    expect(matchSizeToPicked("EU 40", null, picks)?.gtin).toBe("0194502876000");
  });

  it("matches half sizes across notations", () => {
    expect(matchSizeToPicked("EU 40 1/2", null, picks)?.gtin).toBe("0194502876017");
    expect(matchSizeToPicked("EU 40.5", null, picks)?.gtin).toBe("0194502876017");
  });
});

describe("normalizeStyleCode", () => {
  it("uppercases", () => {
    expect(normalizeStyleCode(" dd1391-100 ")).toBe("DD1391-100");
  });
});
