import { describe, expect, it } from "vitest";
import {
  normSizeEU,
  prebuyBlocksNewPurchase,
  sizeFromSku,
  sizesCompatible,
  styleIdFromSku,
  type PrebuyDedupeResult,
} from "@/lib/stockxAutoCheckout/prebuyDedupe";

describe("styleIdFromSku / sizeFromSku", () => {
  it("strips Nike size suffix", () => {
    expect(styleIdFromSku("CD0609-001-39")).toBe("CD0609-001");
    expect(sizeFromSku("CD0609-001-39")).toBe("39");
  });

  it("handles adidas thirds", () => {
    expect(styleIdFromSku("JI1281-43 1/3")).toBe("JI1281");
    expect(sizeFromSku("JI1281-43 1/3")).toBe("43 ⅓");
    expect(sizeFromSku("JR0847-36 2/3")).toBe("36 ⅔");
  });

  it("handles OS backpack", () => {
    expect(sizeFromSku("1af0c9af-b837-43ab-8e62-ac4eb576f295-OS")).toBe("OS");
  });
});

describe("sizesCompatible", () => {
  it("matches EU thirds", () => {
    expect(sizesCompatible("43 ⅓", "EU 43.333")).toBe(true);
    expect(sizesCompatible("36 ⅔", "36⅔")).toBe(true);
    expect(sizesCompatible("37.5", "EU 37.5")).toBe(true);
    expect(sizesCompatible("39", "EU 40")).toBe(false);
  });

  it("normalizes EU prefix", () => {
    expect(normSizeEU("EU 43")).toBe("43");
    expect(normSizeEU("EUEU 39")).toBe("39");
  });
});

describe("prebuyBlocksNewPurchase", () => {
  const base = {
    detail: "",
    gmailHits: [],
    stxCandidates: [],
  } satisfies Omit<PrebuyDedupeResult, "verdict">;

  it("blocks gmail / unlinked / skip / matched", () => {
    expect(prebuyBlocksNewPurchase({ ...base, verdict: "BUY_OK" })).toBe(false);
    expect(prebuyBlocksNewPurchase({ ...base, verdict: "ALREADY_BOUGHT_GMAIL" })).toBe(true);
    expect(prebuyBlocksNewPurchase({ ...base, verdict: "MATCH_UNLINKED_STX" })).toBe(true);
    expect(prebuyBlocksNewPurchase({ ...base, verdict: "SKIP_REASON" })).toBe(true);
    expect(prebuyBlocksNewPurchase({ ...base, verdict: "ALREADY_MATCHED" })).toBe(true);
  });
});
