import { describe, expect, it } from "vitest";
import { sameGtinKey, toGtin14 } from "./gtinKey";

describe("toGtin14", () => {
  it("pads UPC/EAN to GTIN-14", () => {
    expect(toGtin14("198486779739")).toBe("00198486779739");
    expect(toGtin14("00198486779739")).toBe("00198486779739");
    expect(toGtin14(null)).toBe(null);
  });

  it("matches padded vs raw", () => {
    expect(sameGtinKey("198486779739", "00198486779739")).toBe(true);
  });
});
