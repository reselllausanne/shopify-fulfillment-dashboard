import { afterEach, describe, expect, it } from "vitest";
import { resolveGalaxusEvidenceStock, usesGalaxusEvidenceStock } from "@/galaxus/exports/evidenceStock";

const now = new Date("2026-10-08T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

describe("evidence stock", () => {
  afterEach(() => {
    delete process.env.GALAXUS_EVIDENCE_STOCK_SUPPLIERS;
    delete process.env.GALAXUS_EVIDENCE_MAX_AGE_DAYS;
  });

  it("applies to BWZ by default only", () => {
    expect(usesGalaxusEvidenceStock("bwz_123")).toBe(true);
    expect(usesGalaxusEvidenceStock("haw_123")).toBe(false);
    expect(usesGalaxusEvidenceStock("stx_123")).toBe(false);
    process.env.GALAXUS_EVIDENCE_STOCK_SUPPLIERS = "bwz,haw";
    expect(usesGalaxusEvidenceStock("haw_123")).toBe(true);
  });

  it("publishes fresh evidence qty", () => {
    expect(resolveGalaxusEvidenceStock({ publishedQty: 8, lastProofAt: daysAgo(1) }, now)).toBe(8);
  });

  it("publishes 0 when evidence is missing, stale or zero", () => {
    expect(resolveGalaxusEvidenceStock(undefined, now)).toBe(0);
    expect(resolveGalaxusEvidenceStock({ publishedQty: 8, lastProofAt: null }, now)).toBe(0);
    expect(resolveGalaxusEvidenceStock({ publishedQty: 8, lastProofAt: daysAgo(2.1) }, now)).toBe(0);
    expect(resolveGalaxusEvidenceStock({ publishedQty: 0, lastProofAt: daysAgo(1) }, now)).toBe(0);
  });

  it("defaults to a 2-day max age", () => {
    expect(resolveGalaxusEvidenceStock({ publishedQty: 2, lastProofAt: daysAgo(1.9) }, now)).toBe(2);
    expect(resolveGalaxusEvidenceStock({ publishedQty: 2, lastProofAt: daysAgo(2.1) }, now)).toBe(0);
  });

  it("respects GALAXUS_EVIDENCE_MAX_AGE_DAYS", () => {
    process.env.GALAXUS_EVIDENCE_MAX_AGE_DAYS = "14";
    expect(resolveGalaxusEvidenceStock({ publishedQty: 3, lastProofAt: daysAgo(9) }, now)).toBe(3);
  });
});
