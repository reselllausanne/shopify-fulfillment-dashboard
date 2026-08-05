import { describe, expect, it } from "vitest";
import {
  normalizeInboundHomeAwb,
  normalizeInboundHomeScanCode,
} from "@/app/lib/stockxInboundHomeRoutes";

describe("stockxInboundHomeRoutes normalization", () => {
  it("normalizes StockX order numbers", () => {
    expect(normalizeInboundHomeScanCode("#03-YYCTJCFCFH")).toBe("03-YYCTJCFCFH");
    expect(normalizeInboundHomeScanCode("03-yyctjcfcfh")).toBe("03-YYCTJCFCFH");
  });

  it("normalizes UPS AWB", () => {
    expect(normalizeInboundHomeAwb("1ZRR24456793884588")).toBe("1ZRR24456793884588");
    expect(normalizeInboundHomeAwb("1zr1h0146710944652")).toBe("1ZR1H0146710944652");
    expect(normalizeInboundHomeAwb("1Z R1H 014 6710 9446 52")).toBe("1ZR1H0146710944652");
    expect(normalizeInboundHomeAwb("]C11ZR1H0146710944652")).toBe("1ZR1H0146710944652");
  });
});
