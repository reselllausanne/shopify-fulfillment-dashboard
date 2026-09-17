import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  classifyMerchantPricingError,
  mapCompetitivenessRow,
  mapInsightsRow,
  mergePricingSignals,
} from "@/adsanalytics/merchant/pricingClient";

describe("classifyMerchantPricingError", () => {
  it("detects scope / auth / quota / api-disabled / insights", () => {
    expect(
      classifyMerchantPricingError(403, "ACCESS_TOKEN_SCOPE_INSUFFICIENT")
    ).toBe("scope_insufficient");
    expect(classifyMerchantPricingError(401, "invalid_token")).toBe("auth_failed");
    expect(classifyMerchantPricingError(429, "rate limit")).toBe("quota_exceeded");
    expect(
      classifyMerchantPricingError(403, "SERVICE_DISABLED: merchantapi.googleapis.com is disabled")
    ).toBe("api_not_enabled");
    expect(
      classifyMerchantPricingError(400, "Price insights are not available for this account")
    ).toBe("market_insights_unavailable");
    expect(classifyMerchantPricingError(400, "No GTIN matches found")).toBe("no_gtin_matches");
  });
});

describe("mapCompetitivenessRow (mocked Google payload)", () => {
  it("normalizes nested Merchant Reports JSON", () => {
    const row = mapCompetitivenessRow(
      {
        priceCompetitivenessProductView: {
          id: "online~fr~CH~sku-1",
          offerId: "sku-1",
          title: "Shoe",
          brand: "Nike",
          reportCountryCode: "CH",
          price: { amountMicros: "120000000", currencyCode: "CHF" },
          benchmarkPrice: { amountMicros: "100000000", currencyCode: "CHF" },
        },
      },
      "CH"
    );
    expect(row).toMatchObject({
      merchantProductId: "online~fr~CH~sku-1",
      offerId: "sku-1",
      countryCode: "CH",
      currentPrice: 120,
      benchmarkPrice: 100,
      currency: "CHF",
    });
  });

  it("drops non-CH rows", () => {
    expect(
      mapCompetitivenessRow(
        {
          priceCompetitivenessProductView: {
            id: "online~de~DE~x",
            reportCountryCode: "DE",
            price: { amountMicros: "1", currencyCode: "EUR" },
          },
        },
        "CH"
      )
    ).toBeNull();
  });
});

describe("mapInsightsRow (mocked Google payload)", () => {
  it("maps suggested price + predicted fractions", () => {
    const row = mapInsightsRow(
      {
        priceInsightsProductView: {
          id: "online:en:CH:offer-9",
          offer_id: "offer-9",
          title: "Bag",
          brand: "Acme",
          price: { amountMicros: "50000000", currencyCode: "CHF" },
          suggestedPrice: { amountMicros: "45000000", currencyCode: "CHF" },
          predictedImpressionsChangeFraction: 0.1,
          predictedClicksChangeFraction: 0.05,
          predictedConversionsChangeFraction: 0.02,
        },
      },
      "CH"
    );
    expect(row).toMatchObject({
      offerId: "offer-9",
      currentPrice: 50,
      suggestedPrice: 45,
      predictedImpressionsChange: 0.1,
      predictedClicksChange: 0.05,
      predictedConversionsChange: 0.02,
    });
  });
});

describe("mergePricingSignals", () => {
  it("merges by offer id and computes benchmark gaps", () => {
    const capturedAt = new Date("2026-09-10T12:00:00.000Z");
    const signals = mergePricingSignals(
      [
        {
          merchantProductId: "online~en~CH~a",
          offerId: "a",
          title: "A",
          brand: "B",
          countryCode: "CH",
          currentPrice: 110,
          currency: "CHF",
          benchmarkPrice: 100,
          benchmarkCurrency: "CHF",
        },
      ],
      [
        {
          merchantProductId: "online~en~CH~a",
          offerId: "a",
          title: "A",
          brand: "B",
          currentPrice: 110,
          currency: "CHF",
          suggestedPrice: 95,
          suggestedCurrency: "CHF",
          predictedImpressionsChange: 0.2,
          predictedClicksChange: 0.1,
          predictedConversionsChange: 0.05,
        },
      ],
      "CH",
      capturedAt
    );
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      offerId: "a",
      benchmarkGapAmount: 10,
      benchmarkGapPercent: 10,
      suggestedPrice: 95,
      predictedImpressionsChange: 0.2,
    });
  });
});

describe("read-only surface", () => {
  it("pricingClient source never imports product write endpoints", () => {
    const src = readFileSync(
      path.join(process.cwd(), "adsanalytics/merchant/pricingClient.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/productInputs:insert/);
    expect(src).not.toMatch(/productInputs.*DELETE/i);
    expect(src).not.toMatch(/insertSupplementalProductLabel/);
    expect(src).not.toMatch(/deleteSupplementalProductInput/);
    expect(src).not.toMatch(/content\.googleapis\.com/);
    expect(src).toMatch(/reports:search/);
  });
});
