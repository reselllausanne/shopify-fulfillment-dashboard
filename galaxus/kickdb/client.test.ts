import { describe, expect, it } from "vitest";
import { extractVariantGtin, kickdbVariantMatchesGtin, extractVariantEan, pickPersistedKickdbBarcodes } from "@/galaxus/kickdb/client";

describe("kickdbVariantMatchesGtin", () => {
  it("matches EAN-13 when primary extract would be UPC", () => {
    const variant = {
      gtin: "194851127426",
      identifiers: [
        { identifier: "61923225", identifier_type: "GTIN-8" },
        { identifier: "194851127426", identifier_type: "UPC" },
        { identifier: "6941428241450", identifier_type: "EAN-13" },
      ],
    } as any;
    expect(extractVariantGtin(variant)).toBe("194851127426");
    expect(kickdbVariantMatchesGtin(variant, "6941428241450")).toBe(true);
    expect(kickdbVariantMatchesGtin(variant, "194851127426")).toBe(true);
  });
});

describe("extractVariantGtin", () => {
  it("accepts EAN-13 identifier_type when it is the only barcode", () => {
    const variant = {
      identifiers: [{ identifier: "4550457465946", identifier_type: "EAN-13" }],
    } as any;
    expect(extractVariantGtin(variant)).toBe("4550457465946");
  });

  it("accepts GTIN-8 / UPC when they are the only barcode", () => {
    const gtin8 = {
      identifiers: [{ identifier: "61923225", identifier_type: "GTIN-8" }],
    } as any;
    const upca = {
      identifiers: [{ identifier: "194851127426", identifier_type: "UPC-A" }],
    } as any;
    expect(extractVariantGtin(gtin8)).toBe("61923225");
    expect(extractVariantGtin(upca)).toBe("194851127426");
  });

  it("prefers UPC over EAN-13 regardless of array order (Jordan UNC Reimagined EU 43)", () => {
    const variant = {
      identifiers: [
        { identifier: "6954000309967", identifier_type: "EAN-13" },
        { identifier: "197863751597", identifier_type: "UPC" },
        { identifier: "00197863751597", identifier_type: "ITF-14" },
      ],
    } as any;
    expect(extractVariantGtin(variant)).toBe("197863751597");
  });

  it("uses ITF-14 with leading zeros stripped when UPC is missing", () => {
    const variant = {
      identifiers: [
        { identifier: "6954000309967", identifier_type: "EAN-13" },
        { identifier: "00197863751597", identifier_type: "ITF-14" },
      ],
    } as any;
    expect(extractVariantGtin(variant)).toBe("197863751597");
  });
});

describe("extractVariantEan", () => {
  it("returns EAN-13 when both UPC and EAN exist (ASICS EU39 pattern)", () => {
    const variant = {
      identifiers: [
        { identifier: "197298747899", identifier_type: "UPC" },
        { identifier: "4570158520201", identifier_type: "EAN-13" },
      ],
    } as any;
    expect(extractVariantEan(variant)).toBe("4570158520201");
    expect(extractVariantGtin(variant)).toBe("197298747899");
  });
});

describe("pickPersistedKickdbBarcodes", () => {
  it("stores UPC on gtin and EAN on ean without duplicating", () => {
    const variant = {
      identifiers: [
        { identifier: "197298747899", identifier_type: "UPC" },
        { identifier: "4570158520201", identifier_type: "EAN-13" },
      ],
    } as any;
    expect(pickPersistedKickdbBarcodes(variant)).toEqual({
      gtin: "197298747899",
      ean: "4570158520201",
    });
  });
});
