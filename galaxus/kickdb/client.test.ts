import { describe, expect, it } from "vitest";
import { extractVariantGtin, kickdbVariantMatchesGtin } from "@/galaxus/kickdb/client";

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
    expect(kickdbVariantMatchesGtin(variant, "6941428241450")).toBe(true);
    expect(kickdbVariantMatchesGtin(variant, "194851127426")).toBe(true);
  });
});

describe("extractVariantGtin", () => {
  it("accepts EAN-13 identifier_type", () => {
    const variant = {
      identifiers: [{ identifier: "4550457465946", identifier_type: "EAN-13" }],
    } as any;
    expect(extractVariantGtin(variant)).toBe("4550457465946");
  });

  it("accepts GTIN-* / UPC-* variants", () => {
    const gtin8 = {
      identifiers: [{ identifier: "61923225", identifier_type: "GTIN-8" }],
    } as any;
    const upca = {
      identifiers: [{ identifier: "194851127426", identifier_type: "UPC-A" }],
    } as any;
    expect(extractVariantGtin(gtin8)).toBe("61923225");
    expect(extractVariantGtin(upca)).toBe("194851127426");
  });
});
