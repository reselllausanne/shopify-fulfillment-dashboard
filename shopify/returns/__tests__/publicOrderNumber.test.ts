import { describe, expect, it } from "vitest";
import {
  digitsFromPublicOrderInput,
  formatPublicOrderNumberFromDigits,
  parseStrictPublicOrderNumber,
} from "../publicOrderNumber";

describe("publicOrderNumber", () => {
  it("accepts # plus digits", () => {
    expect(parseStrictPublicOrderNumber("#6141")).toBe("#6141");
    expect(parseStrictPublicOrderNumber("#4044")).toBe("#4044");
  });

  it("rejects bare digits and strange formats", () => {
    expect(parseStrictPublicOrderNumber("6141")).toBeNull();
    expect(parseStrictPublicOrderNumber("#6141-R1")).toBeNull();
    expect(parseStrictPublicOrderNumber("#abc")).toBeNull();
    expect(parseStrictPublicOrderNumber("order-6141")).toBeNull();
  });

  it("formats digits input for UI", () => {
    expect(digitsFromPublicOrderInput("61a41!")).toBe("6141");
    expect(formatPublicOrderNumberFromDigits("6141")).toBe("#6141");
    expect(formatPublicOrderNumberFromDigits("")).toBe("");
  });
});
