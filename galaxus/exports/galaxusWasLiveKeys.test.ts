import { describe, expect, it } from "vitest";
import { shouldEmitGalaxusDelistZero } from "@/galaxus/exports/galaxusWasLiveKeys";

describe("shouldEmitGalaxusDelistZero", () => {
  it("emits zero only for keys that were live on Galaxus", () => {
    const wasLive = new Set(["STX_LIVE"]);
    expect(shouldEmitGalaxusDelistZero("STX_LIVE", wasLive)).toBe(true);
    expect(shouldEmitGalaxusDelistZero("STX_NEVER", wasLive)).toBe(false);
  });

  it("fails open when wasLive set missing (load error)", () => {
    expect(shouldEmitGalaxusDelistZero("STX_ANY", null)).toBe(true);
  });

  it("rejects empty keys", () => {
    expect(shouldEmitGalaxusDelistZero("", new Set(["STX_1"]))).toBe(false);
    expect(shouldEmitGalaxusDelistZero(null, null)).toBe(false);
  });
});
