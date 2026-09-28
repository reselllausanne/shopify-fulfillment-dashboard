import { describe, expect, it } from "vitest";
import {
  isBarcodeOrAwbLike,
  looksLikeManualQuery,
  shouldAllowScanAutoActions,
} from "./scanInputGuards";

describe("looksLikeManualQuery", () => {
  it("treats short letter queries as manual", () => {
    expect(looksLikeManualQuery("allo")).toBe(true);
    expect(looksLikeManualQuery("nike")).toBe(true);
  });

  it("treats pure GTINs as non-manual", () => {
    expect(looksLikeManualQuery("4056133050135")).toBe(false);
  });
});

describe("shouldAllowScanAutoActions", () => {
  it("never allows autos from suggestion pick", () => {
    expect(
      shouldAllowScanAutoActions({
        code: "4056133050135",
        fromSuggestion: true,
      })
    ).toBe(false);
  });

  it("blocks typed junk like allo", () => {
    expect(shouldAllowScanAutoActions({ code: "allo" })).toBe(false);
  });

  it("allows scanner burst even for short codes", () => {
    expect(
      shouldAllowScanAutoActions({ code: "allo", fromScannerBurst: true })
    ).toBe(true);
  });

  it("allows barcode-like non-manual codes", () => {
    expect(shouldAllowScanAutoActions({ code: "4056133050135" })).toBe(true);
    expect(isBarcodeOrAwbLike("4056133050135")).toBe(true);
  });
});
