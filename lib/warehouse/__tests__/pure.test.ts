import { describe, expect, it } from "vitest";
import { buildLevelCode, buildLevelShortCode, buildUnitLabelCode, classifyScan, isValidGtinChecksum, stripScannerTransport, toCsv, unitShortRef } from "../codes";
import { parseCsv } from "../imports";
import { LABEL_PROFILES, layoutLabel, qrMatrix, renderLabelSvg, renderLabelsPdf, type PairLabelPayload } from "../labels";
import { assertValidOpKey, hashRequest } from "../operations";
import { computeBreakdown, computeStockxProposal } from "../pricing";

const UUID = "2f6c1a7e-9b3d-4c21-8e5f-0a1b2c3d4e5f";

describe("codes — scan classification (A16–A30, C01)", () => {
  it("recognises our unit label and normalises case", () => {
    const c = classifyScan(`${UUID.toUpperCase()}-ch01`);
    expect(c).toEqual({ kind: "UNIT_LABEL", code: `${UUID}-CH01`, unitId: UUID, issuingSiteCode: "CH01" });
  });

  it("strips scanner transport (CR/LF, AIM prefix) without altering the code", () => {
    expect(stripScannerTransport(`]Q1${UUID}-CH01\r\n`)).toBe(`${UUID}-CH01`);
    expect(classifyScan(`\t${UUID}-CH01\r`).kind).toBe("UNIT_LABEL");
  });

  it("treats a foreign UUID-shaped code as an external reference, never as our identity", () => {
    expect(classifyScan(UUID).kind).toBe("EXTERNAL_UUID_REF");
    // version nibble 1 → not a v4 → not ours even with a site-like suffix
    expect(classifyScan("2f6c1a7e-9b3d-1c21-8e5f-0a1b2c3d4e5f-CH01").kind).toBe("EXTERNAL_UUID_REF");
    expect(classifyScan(`${UUID}-OLDSYS`).kind).toBe("EXTERNAL_UUID_REF");
  });

  it("classifies locations, GTIN and refuses a spreadsheet-mangled number", () => {
    expect(classifyScan("ch01-a-r03-t02-n04")).toEqual({ kind: "LOCATION", code: "CH01-A-R03-T02-N04", siteCode: "CH01" });
    expect(classifyScan("CH01-CART-01").kind).toBe("LOCATION");
    expect(classifyScan("0198480965312")).toMatchObject({ kind: "GTIN", gtin: "0198480965312" });
    expect(classifyScan("1.98481E+11")).toEqual({ kind: "MANGLED_NUMBER", raw: "1.98481E+11" });
    expect(classifyScan("   ").kind).toBe("EMPTY");
    expect(classifyScan("hello world").kind).toBe("UNKNOWN");
  });

  it("keeps GTIN leading zeros and checks the GS1 check digit", () => {
    expect(isValidGtinChecksum("4006381333931")).toBe(true);
    expect(isValidGtinChecksum("4006381333932")).toBe(false);
    expect(isValidGtinChecksum("036000291452")).toBe(true); // UPC-A with leading zero
    const c = classifyScan("036000291452");
    expect(c).toMatchObject({ kind: "GTIN", gtin: "036000291452", checksumValid: true });
  });

  it("builds label, short reference and location codes deterministically", () => {
    expect(buildUnitLabelCode(UUID.toUpperCase(), "ch01")).toBe(`${UUID}-CH01`);
    expect(() => buildUnitLabelCode("not-a-uuid", "CH01")).toThrow();
    expect(() => buildUnitLabelCode(UUID, "SWISS")).toThrow();
    expect(unitShortRef(UUID)).toBe("2F6C-1A7E");
    expect(buildLevelCode({ siteCode: "CH01", sector: "A", rowNo: 3, rackNo: 2, levelNo: 4 })).toBe("CH01-A-R03-T02-N04");
    expect(buildLevelShortCode({ sector: "A", rowNo: 3, rackNo: 2, levelNo: 4 })).toBe("A-03-02-4");
  });

  it("CSV export neutralises formula injection and quotes separators", () => {
    const csv = toCsv(["a", "b"], [["=SUM(A1)", 'x;"y"']]);
    expect(csv).toContain("'=SUM(A1)");
    expect(csv).toContain('"x;""y"""');
  });
});

describe("idempotency keys (C06–C09)", () => {
  it("accepts 8–120 safe characters only", () => {
    expect(() => assertValidOpKey("rcv-12345678")).not.toThrow();
    expect(() => assertValidOpKey("short")).toThrow();
    expect(() => assertValidOpKey("has space 12345")).toThrow();
    expect(() => assertValidOpKey(undefined)).toThrow();
    expect(() => assertValidOpKey("x".repeat(121))).toThrow();
  });

  it("request hash is stable across key order and ignores undefined", () => {
    expect(hashRequest({ a: 1, b: [1, { c: 2, d: undefined }] })).toBe(hashRequest({ b: [1, { c: 2 }], a: 1 }));
    expect(hashRequest({ a: 1 })).not.toBe(hashRequest({ a: 2 }));
  });
});

describe("labels (A31–A40)", () => {
  const payload: PairLabelPayload = { kind: "PAIR", code: `${UUID}-CH01`, unitId: UUID, title: "Nike Air Force 1 '07", sizeLabel: "EU 42.5", styleCode: "CW2288-111", isReprint: false };

  it("QR matrix is square, deterministic and large enough for 41 characters at level Q", () => {
    const a = qrMatrix(payload.code);
    const b = qrMatrix(payload.code);
    expect(a.size).toBe(b.size);
    expect(a.dark).toEqual(b.dark);
    expect(a.size).toBeGreaterThanOrEqual(29);
    expect(a.dark.length).toBe(a.size * a.size);
    expect(qrMatrix(`${UUID}-DE01`).dark).not.toEqual(a.dark);
  });

  it("pair label fits 50 × 30 mm with a quiet zone and modules ≥ 0.33 mm (300 dpi ≥ 4 dots)", () => {
    const { widthMm, heightMm } = LABEL_PROFILES.PAIR;
    const layout = layoutLabel(payload, widthMm, heightMm);
    expect(layout.widthMm).toBe(50);
    expect(layout.heightMm).toBe(30);
    for (const r of layout.rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(widthMm + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(heightMm + 1e-6);
    }
    const moduleMm = Math.min(...layout.rects.map((r) => r.h));
    expect(moduleMm).toBeGreaterThanOrEqual(0.33);
    const texts = layout.texts.map((t) => t.text).join(" ");
    expect(texts).toContain("2F6C-1A7E");
    expect(texts).toContain("42.5");
  });

  it("SVG and PDF render; a reprint is marked; one page per label", () => {
    const svg = renderLabelSvg(payload, 50, 30);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('width="50mm"');
    const pdf = renderLabelsPdf([
      { payload, widthMm: 50, heightMm: 30 },
      { payload: { ...payload, isReprint: true }, widthMm: 50, heightMm: 30 },
      { payload: { kind: "LOCATION", code: "CH01-A-R01-T01-N01", shortCode: "A-01-01-1", locationKind: "LEVEL" }, widthMm: 100, heightMm: 50 },
    ]);
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-1.")).toBe(true);
    expect(text).toContain("/Count 3");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    // 50 mm = 141.73 pt, 30 mm = 85.04 pt
    expect(text).toMatch(/MediaBox \[0 0 141\.7\d* 85\.0\d*\]/);
  });
});

describe("pricing math (B21–B30)", () => {
  const terms = { commissionRate: 0.1, fixedFee: 5 };

  it("public price → fees → net, rounded to the cent", () => {
    expect(computeBreakdown(200, terms)).toEqual({ publicPrice: 200, fees: 25, sellerNet: 175, margin: 25 });
    expect(computeBreakdown(129.99, terms)).toEqual({ publicPrice: 129.99, fees: 18, sellerNet: 111.99, margin: 18 });
  });

  it("never invents amounts when terms are missing", () => {
    expect(computeBreakdown(200, null)).toEqual({ publicPrice: 200, fees: null, sellerNet: null, margin: null });
    expect(computeBreakdown(null, terms)).toEqual({ publicPrice: null, fees: null, sellerNet: null, margin: null });
  });

  it("an explicit seller net wins and fees are the difference", () => {
    expect(computeBreakdown(200, terms, 150)).toEqual({ publicPrice: 200, fees: 50, sellerNet: 150, margin: 50 });
  });

  it("StockX 200 × 0.70 = 140, read as public price unless the agreement says seller net", () => {
    expect(computeStockxProposal({ basisAmount: 200, factor: 0.7, basisIs: "UNCONFIRMED", terms })).toMatchObject({ publicPrice: 140, sellerNet: 121, interpretedAs: "PUBLIC_PRICE" });
    expect(computeStockxProposal({ basisAmount: 200, factor: 0.7, basisIs: "PUBLIC_PRICE", terms })).toMatchObject({ publicPrice: 140 });
    expect(computeStockxProposal({ basisAmount: 200, factor: 0.7, basisIs: "SELLER_NET", terms })).toEqual({ publicPrice: null, fees: null, sellerNet: 140, margin: null, interpretedAs: "SELLER_NET" });
  });
});

describe("CSV parsing (A07, C28)", () => {
  it("handles BOM, semicolons, quotes and keeps values as text", () => {
    const { header, rows } = parseCsv('\uFEFFGTIN;Description;Quantité\r\n0198480965312;"Sac ""Elite""; blanc";2\r\n\r\n');
    expect(header).toEqual(["gtin", "description", "quantité"]);
    expect(rows).toEqual([["0198480965312", 'Sac "Elite"; blanc', "2"]]);
  });

  it("handles commas and embedded newlines", () => {
    const { rows } = parseCsv('a,b\n"line1\nline2",x\n');
    expect(rows).toEqual([["line1\nline2", "x"]]);
  });
});
