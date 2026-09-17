import { describe, expect, it } from "vitest";

import {
  computeBenchmarkGap,
  coverageRate,
  microsToCurrency,
  parseGooglePrice,
  parseMerchantProductId,
} from "@/adsanalytics/merchant/pricingNormalize";

describe("microsToCurrency", () => {
  it("divides by 1e6", () => {
    expect(microsToCurrency(19_990_000)).toBe(19.99);
    expect(microsToCurrency("29990000")).toBe(29.99);
  });

  it("returns null for empty / invalid", () => {
    expect(microsToCurrency(null)).toBeNull();
    expect(microsToCurrency(undefined)).toBeNull();
    expect(microsToCurrency("")).toBeNull();
    expect(microsToCurrency("nope")).toBeNull();
  });
});

describe("parseGooglePrice", () => {
  it("reads amountMicros + currencyCode", () => {
    expect(parseGooglePrice({ amountMicros: "1000000", currencyCode: "CHF" })).toEqual({
      amount: 1,
      currency: "CHF",
    });
  });

  it("falls back to Content-API value/currency", () => {
    expect(parseGooglePrice({ value: "12.5", currency: "CHF" })).toEqual({
      amount: 12.5,
      currency: "CHF",
    });
  });
});

describe("parseMerchantProductId", () => {
  it("parses Content-API colon form", () => {
    expect(parseMerchantProductId("online:fr:CH:sku-123")).toEqual({
      merchantProductId: "online:fr:CH:sku-123",
      channel: "online",
      languageCode: "fr",
      feedLabel: "CH",
      offerId: "sku-123",
    });
  });

  it("parses Merchant REST tilde form with channel", () => {
    expect(parseMerchantProductId("online~de~CH~abc")).toEqual({
      merchantProductId: "online~de~CH~abc",
      channel: "online",
      languageCode: "de",
      feedLabel: "CH",
      offerId: "abc",
    });
  });

  it("parses three-part tilde REST id without channel", () => {
    expect(parseMerchantProductId("en~CH~offer_99")).toEqual({
      merchantProductId: "en~CH~offer_99",
      channel: null,
      languageCode: "en",
      feedLabel: "CH",
      offerId: "offer_99",
    });
  });

  it("preserves offer ids that themselves contain separators", () => {
    expect(parseMerchantProductId("online:en:CH:foo:bar:baz").offerId).toBe("foo:bar:baz");
    expect(parseMerchantProductId("online~en~CH~foo~bar").offerId).toBe("foo~bar");
  });

  it("treats bare ids as offerId", () => {
    expect(parseMerchantProductId("plain-sku").offerId).toBe("plain-sku");
  });
});

describe("computeBenchmarkGap", () => {
  it("computes amount and percent vs benchmark", () => {
    expect(computeBenchmarkGap(120, 100)).toEqual({ gapAmount: 20, gapPercent: 20 });
    expect(computeBenchmarkGap(80, 100)).toEqual({ gapAmount: -20, gapPercent: -20 });
  });

  it("returns nulls when either side missing", () => {
    expect(computeBenchmarkGap(null, 100)).toEqual({ gapAmount: null, gapPercent: null });
    expect(computeBenchmarkGap(100, null)).toEqual({ gapAmount: null, gapPercent: null });
  });

  it("keeps amount but null percent when benchmark is zero", () => {
    expect(computeBenchmarkGap(10, 0)).toEqual({ gapAmount: 10, gapPercent: null });
  });
});

describe("coverageRate", () => {
  it("handles zero denominator", () => {
    expect(coverageRate(0, 0)).toBe(0);
    expect(coverageRate(3, 4)).toBe(0.75);
  });
});
