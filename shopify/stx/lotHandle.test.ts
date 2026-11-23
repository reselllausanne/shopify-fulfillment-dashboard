import { describe, expect, it } from "vitest";
import { lotCountFromHandle, sameLotSize } from "./lotHandle";

describe("lotHandle", () => {
  it("parses lot size", () => {
    expect(lotCountFromHandle("2026-pokemon-chaos-rising-pokemon-center-elite-trainer-box-4x-lot")).toBe(4);
    expect(lotCountFromHandle("pokemon-tcg-151-booster-bundle-10x-lot")).toBe(10);
    expect(lotCountFromHandle("2026-pokemon-chaos-rising-pokemon-center-elite-trainer-box")).toBe(1);
    expect(lotCountFromHandle(null)).toBe(1);
  });
  it("rejects single vs lot", () => {
    expect(sameLotSize("x-elite-trainer-box", "x-elite-trainer-box-4x-lot")).toBe(false);
    expect(sameLotSize("x-box-2x-lot", "x-box-4x-lot")).toBe(false);
    expect(sameLotSize("x-box-4x-lot", "x-box-4x-lot")).toBe(true);
  });
});
