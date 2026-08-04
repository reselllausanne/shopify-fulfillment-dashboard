import { describe, expect, it } from "vitest";
import { cleanGtin, gtinCandidates, gtinEquals } from "@/shopify/restock/gtinNormalize";

describe("gtinNormalize — padding aliases", () => {
  it("strips non-digits", () => {
    expect(cleanGtin(" 0196-123 ")).toBe("0196123");
  });

  it("treats leading-zero forms as equal", () => {
    expect(gtinEquals("196123456789", "0196123456789")).toBe(true);
    expect(gtinEquals("00196123456789", "196123456789")).toBe(true);
    expect(gtinEquals("196123456789", "196123456780")).toBe(false);
  });

  it("expands UPC/EAN/GTIN-14 pad candidates", () => {
    const cands = gtinCandidates("196123456789");
    expect(cands).toContain("196123456789");
    expect(cands).toContain("0196123456789");
    expect(cands).toContain("00196123456789");
  });

  it("keeps already-padded forms and stripped form", () => {
    const cands = gtinCandidates("0196123456789");
    expect(cands).toContain("0196123456789");
    expect(cands).toContain("196123456789");
    expect(cands).toContain("00196123456789");
  });
});
