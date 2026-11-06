import { describe, expect, it } from "vitest";
import { cleanGtin, gtinCandidates, gtinEquals, normalizeGtinForLookup } from "@/shopify/restock/gtinNormalize";

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

  // ── EAN-13 starting with non-zero digit (Adidas EU / European barcodes) ──

  it("EAN-13 starting with 4 — keeps 13-digit form, never produces a bogus 12-digit UPC", () => {
    const cands = gtinCandidates("4065432496469");
    // Must contain the exact scanned EAN-13
    expect(cands).toContain("4065432496469");
    // May contain the GTIN-14 zero-padded form
    expect(cands).toContain("04065432496469");
    // Must NOT contain any 12-digit truncation (would be a different, unrelated product)
    expect(cands.some((c) => c.length === 12)).toBe(false);
  });

  it("EAN-13 starting with 4 — gtinEquals ignores only leading zeros, not arbitrary digits", () => {
    // The EAN-13 and a random 12-digit number are NOT equal
    expect(gtinEquals("4065432496469", "406543249646")).toBe(false);
    // But the EAN-13 and its zero-padded GTIN-14 ARE equal
    expect(gtinEquals("4065432496469", "04065432496469")).toBe(true);
  });
});

describe("normalizeGtinForLookup", () => {
  it("UPC-A (12-digit) → kept as-is", () => {
    expect(normalizeGtinForLookup("196123456789")).toBe("196123456789");
  });

  it("EAN-13 starting with 0 → strips leading zero to UPC-A", () => {
    expect(normalizeGtinForLookup("0196123456789")).toBe("196123456789");
  });

  it("EAN-13 starting with 4 (Adidas EU) → kept as 13-digit, no stripping", () => {
    // 4065432496469 starts with '4' — stripping to 12 digits would be wrong
    expect(normalizeGtinForLookup("4065432496469")).toBe("4065432496469");
  });

  it("EAN-13 starting with other non-zero digit → kept as 13-digit", () => {
    expect(normalizeGtinForLookup("5901234123457")).toBe("5901234123457");
  });

  it("GTIN-14 starting with 0 → strips to EAN-13", () => {
    expect(normalizeGtinForLookup("00196123456789")).toBe("0196123456789");
  });
});
