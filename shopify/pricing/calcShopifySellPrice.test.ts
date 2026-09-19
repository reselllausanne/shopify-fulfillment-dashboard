import { describe, expect, it } from "vitest";
import { deriveStockxRawAskFromStoredBuyPrice } from "@/galaxus/pricing/suggestedSellPrice";
import {
  calcShopifySellPrice,
  calcShopifySellFromSourceCost,
  calcPhysicalLiquidationSellPrice,
  explainShopifySellPrice,
  resolveShopifyPricingRule,
  resolveStxWebsiteSellPrices,
  ceilToCentime,
  SHOPIFY_FIXED_FULFILLMENT_AND_SHIPPING_CHF,
  SHOPIFY_BLENDED_PAYMENT_COST_RATE,
  SHOPIFY_VAT_FLAT_RATE,
  SHOPIFY_PAID_ADS_RATE,
  SHOPIFY_TARGET_CM2_RATE,
  shopifyLockedDenom,
} from "@/shopify/pricing/calcShopifySellPrice";

/** Locked floor: raw 100 → C=128 → (128+14.5)/0.6795 → ceil centime. */
const EXPECTED_SELL_RAW_100 = 209.72;
const EXPECTED_SELL_RAW_108_45 = 223.15;
const EXPECTED_SELL_RAW_126 = 251.04;
const EXPECTED_SELL_RAW_170 = 320.98;
const BUY_CHF_140 = 140;
const EXPECTED_RAW_FROM_BUY_140 = 108.45;

const ADIDAS_LIFESTYLE = [
  {
    family: "Samba",
    handle: "adidas-samba-og-cloud-white-core-black",
    name: "Adidas Samba OG White",
  },
  {
    family: "Gazelle",
    handle: "adidas-gazelle-indoor-blue-bird",
    name: "Adidas Gazelle Indoor Blue",
  },
  {
    family: "Spezial",
    handle: "adidas-handball-spezial-grey",
    name: "Adidas Handball Spezial Grey",
  },
  {
    family: "Campus",
    handle: "adidas-campus-00s-grey-white",
    name: "Adidas Campus 00s Grey White",
  },
] as const;

describe("calcShopifySellPrice locked formula", () => {
  it("exposes locked constants", () => {
    expect(SHOPIFY_FIXED_FULFILLMENT_AND_SHIPPING_CHF).toBe(14.5);
    expect(SHOPIFY_BLENDED_PAYMENT_COST_RATE).toBe(0.0275);
    expect(SHOPIFY_VAT_FLAT_RATE).toBe(0.023);
    expect(SHOPIFY_PAID_ADS_RATE).toBe(0.15);
    expect(SHOPIFY_TARGET_CM2_RATE).toBe(0.12);
    expect(shopifyLockedDenom()).toBeCloseTo(0.6795, 6);
  });

  it("ceilToCentime never rounds down", () => {
    expect(ceilToCentime(286.351)).toBe(286.36);
    expect(ceilToCentime(286.36)).toBe(286.36);
  });

  it("sourceCost 180.08 → 286.36", () => {
    expect(calcShopifySellFromSourceCost(180.08)).toBe(286.36);
  });

  it("prices brands the same", () => {
    const adidas = calcShopifySellPrice({
      stockxRaw: 100,
      productCategory: "sneakers",
      brand: "adidas",
      productHandle: "adidas-samba-xlg-black-carbon",
    });
    const nike = calcShopifySellPrice({
      stockxRaw: 100,
      productCategory: "sneakers",
      brand: "nike",
      productHandle: "nike-dunk-low",
    });
    const saucony = calcShopifySellPrice({
      stockxRaw: 100,
      productCategory: "sneakers",
      brand: "saucony",
      productHandle: "saucony-progrid",
    });
    expect(adidas).toBe(EXPECTED_SELL_RAW_100);
    expect(adidas).toBe(nike);
    expect(adidas).toBe(saucony);
  });

  it("lifestyle families at buy CHF 140 → locked floor", () => {
    for (const row of ADIDAS_LIFESTYLE) {
      const raw = deriveStockxRawAskFromStoredBuyPrice(BUY_CHF_140, {
        slug: row.handle,
        urlKey: row.handle,
        name: row.name,
      });
      expect(raw).toBe(EXPECTED_RAW_FROM_BUY_140);
      const sell = calcShopifySellPrice({
        stockxRaw: raw!,
        productCategory: "sneakers",
        brand: "adidas",
        productHandle: row.handle,
        productName: row.name,
      });
      expect(sell, row.family).toBe(EXPECTED_SELL_RAW_108_45);

      const explained = explainShopifySellPrice({
        stockxRaw: raw!,
        productCategory: "sneakers",
        brand: "adidas",
        productHandle: row.handle,
        productName: row.name,
      });
      expect(explained.rule).toBe("half");
      expect(explained.cpaCap).toBeNull();
      expect(explained.calculatedSell).toBe(EXPECTED_SELL_RAW_108_45);
    }
  });

  it("mirror cost samples: stockx_raw 100/126/170", () => {
    expect(
      calcShopifySellPrice({
        stockxRaw: 100,
        productHandle: "adidas-samba-og-white",
        brand: "adidas",
      })
    ).toBe(EXPECTED_SELL_RAW_100);
    expect(
      calcShopifySellPrice({
        stockxRaw: 126,
        productHandle: "adidas-gazelle-indoor",
        brand: "adidas",
      })
    ).toBe(EXPECTED_SELL_RAW_126);
    expect(
      calcShopifySellPrice({
        stockxRaw: 170,
        productHandle: "adidas-handball-spezial",
        brand: "adidas",
      })
    ).toBe(EXPECTED_SELL_RAW_170);
    expect(resolveShopifyPricingRule({ productHandle: "adidas-campus-00s" })).toBe("half");
  });

  it("isExpress does not change locked base sell", () => {
    const std = calcShopifySellPrice({ stockxRaw: 100, isExpress: false });
    const exp = calcShopifySellPrice({ stockxRaw: 100, isExpress: true });
    expect(std).toBe(exp);
  });

  it("returns ceil-centime lego price", () => {
    const price = calcShopifySellPrice({
      stockxRaw: 80,
      productCategory: "lego",
      productHandle: "lego-random-set",
    });
    expect(price).not.toBeNull();
    expect(Number.isInteger(Math.round(price! * 100))).toBe(true);
    expect(resolveShopifyPricingRule({ productCategory: "lego" })).toBe("lego");
  });
});

describe("calcPhysicalLiquidationSellPrice", () => {
  it("applies 30% off cost with psych rounding (261.92 → 189)", () => {
    expect(calcPhysicalLiquidationSellPrice(261.92)).toBe(189);
  });
});

describe("resolveStxWebsiteSellPrices", () => {
  const calcFromBuy = (buy: number, isExpress: boolean) =>
    isExpress ? Math.round(buy + 40) : Math.round(buy + 20);

  it("single offer → standard=calc, express=calc+20", () => {
    const r = resolveStxWebsiteSellPrices({
      standardBuyPrice: 100,
      expressBuyPrice: null,
      calcFromBuy: () => 199.72,
    });
    expect(r.mode).toBe("single_plus20");
    expect(r.normalSell).toBe(199.72);
    expect(r.expressSell).toBe(219.72);
  });

  it("express-only → standard=calc(express), express=standard+20", () => {
    const r = resolveStxWebsiteSellPrices({
      standardBuyPrice: null,
      expressBuyPrice: 150,
      deliveryType: "express_standard",
      calcFromBuy: () => 259.15,
    });
    expect(r.mode).toBe("single_plus20");
    expect(r.normalSell).toBe(259.15);
    expect(r.expressSell).toBe(279.15);
  });

  it("distinct dual lanes → each locked calc, no +20", () => {
    const r = resolveStxWebsiteSellPrices({
      standardBuyPrice: 100,
      expressBuyPrice: 130,
      calcFromBuy,
    });
    expect(r.mode).toBe("dual_lane");
    expect(r.normalSell).toBe(120);
    expect(r.expressSell).toBe(170);
  });

  it("identical dual buys treat as single_plus20", () => {
    const r = resolveStxWebsiteSellPrices({
      standardBuyPrice: 100,
      expressBuyPrice: 100,
      calcFromBuy: () => 199.72,
    });
    expect(r.mode).toBe("single_plus20");
    expect(r.expressSell).toBe(219.72);
  });
});
