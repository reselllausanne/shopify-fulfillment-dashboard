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

  it("strips apparel letter size from styleId", () => {
    expect(styleIdFromSku("FB8016-010-S")).toBe("FB8016-010");
    expect(styleIdFromSku("FV1931-107-M")).toBe("FV1931-107");
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

describe("normSizeEU fractional/EU formats (regression: no_variant_match)", () => {
  // Fractions must survive the `EU ` prefix (extractEUSize used to drop them).
  it("thirds with EU prefix compare equal to plain thirds", () => {
    expect(normSizeEU("EU 41 1/3")).toBe("41⅓");
    expect(normSizeEU("41 1/3")).toBe("41⅓");
    expect(normSizeEU("EU 39 1/3")).toBe("39⅓");
    expect(normSizeEU("EU 42 2/3")).toBe("42⅔");
    expect(normSizeEU("42 2/3")).toBe("42⅔");
  });

  it("canonicalizes unicode and decimal thirds", () => {
    expect(normSizeEU("41⅓")).toBe("41⅓");
    expect(normSizeEU("EU 41⅓")).toBe("41⅓");
    expect(normSizeEU("EU 41.333")).toBe("41⅓");
    expect(normSizeEU("EU 42.667")).toBe("42⅔");
  });

  it("keeps half sizes (no false third)", () => {
    expect(normSizeEU("EU 40.5")).toBe("40.5");
    expect(normSizeEU("40,5")).toBe("40.5");
    expect(normSizeEU("EU 35.5")).toBe("35.5");
  });

  it("the two real orders map to the stored sizeRaw", () => {
    // #7582 adidas Forum Wings 1.0 — Shopify "41 1/3" vs DB "EU 41 1/3"
    expect(normSizeEU("41 1/3")).toBe(normSizeEU("EU 41 1/3"));
    // #7590 Hoka Skyflow (W) — Shopify "39 1/3" vs DB "EU 39 1/3"
    expect(normSizeEU("39 1/3")).toBe(normSizeEU("EU 39 1/3"));
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
