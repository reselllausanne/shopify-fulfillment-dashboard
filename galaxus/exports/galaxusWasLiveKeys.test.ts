import { describe, expect, it } from "vitest";
import { shouldEmitGalaxusDelistZero } from "@/galaxus/exports/galaxusWasLiveKeys";

describe("shouldEmitGalaxusDelistZero", () => {
  it("emits zero only for eligible delist keys", () => {
    const eligible = new Set(["STX_NEED_ZERO"]);
    expect(shouldEmitGalaxusDelistZero("STX_NEED_ZERO", eligible)).toBe(true);
    expect(shouldEmitGalaxusDelistZero("STX_ALREADY_ZEROED", eligible)).toBe(false);
  });

  it("fails open when eligible set missing (load error)", () => {
    expect(shouldEmitGalaxusDelistZero("STX_ANY", null)).toBe(true);
  });

  it("rejects empty keys", () => {
    expect(shouldEmitGalaxusDelistZero("", new Set(["STX_1"]))).toBe(false);
    expect(shouldEmitGalaxusDelistZero(null, null)).toBe(false);
  });
});
