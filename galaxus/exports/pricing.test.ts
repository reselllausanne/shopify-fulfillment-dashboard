import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  computeGalaxusSellPriceExVat,
  resolveGalaxusSellExVatForChannel,
  resolveGalaxusTargetNetMarginForSupplier,
  resolveGldLandedCostChf,
  resolveGldLandedExtrasPerPairChf,
  resolveGldMarkupFraction,
  resolveGldTargetNetMargin,
} from "@/galaxus/exports/pricing";

describe("Galaxus STX margin", () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    delete process.env.GALAXUS_TARGET_NET_MARGIN;
    delete process.env.GALAXUS_TARGET_MARGIN;
    delete process.env.GALAXUS_PRICE_SHIPPING_CHF;
    delete process.env.GALAXUS_SHIPPING_CHF;
    delete process.env.GALAXUS_WEL_SHIPPING_CHF;
    delete process.env.GALAXUS_WEL_TARGET_NET_MARGIN;
    delete process.env.GALAXUS_WEL_TARGET_MARGIN;
    delete process.env.GALAXUS_WEL_BUFFER_CHF;
    delete process.env.GALAXUS_WEL_PRICE_BUFFER_CHF;
    delete process.env.GALAXUS_PRICE_BUFFER_CHF;
    delete process.env.GALAXUS_BUFFER_CHF;
    delete process.env.GALAXUS_PRICE_ROUND_TO;
    delete process.env.GALAXUS_ROUND_TO;
    delete process.env.GALAXUS_PRICE_VAT_RATE;
    delete process.env.GALAXUS_VAT_RATE;
    delete process.env.GALAXUS_STX_TARGET_NET_MARGIN;
    delete process.env.GALAXUS_STX_MARGIN_ADJUSTMENT;
    delete process.env.GALAXUS_GLD_TARGET_NET_MARGIN;
    delete process.env.GALAXUS_GLD_SHIP_EUR;
    delete process.env.GALAXUS_GLD_SHIP_PAIRS;
    delete process.env.GALAXUS_GLD_DOUANE_EUR;
    delete process.env.GALAXUS_GLD_DOUANE_PAIRS;
    delete process.env.GALAXUS_GLD_EURCHF;
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it("defaults STX to 12% net margin on sell", () => {
    expect(resolveGalaxusTargetNetMarginForSupplier("stx")).toBeCloseTo(0.12, 5);
  });

  it("sell = (StockX buy + 2 CHF ship) / (1 - 12%)", () => {
    const partners = new Set(["ner", "flo"]);
    const stockxBuy = 177;
    const stxSell = resolveGalaxusSellExVatForChannel(stockxBuy, "stx", partners);
    expect(stxSell).toBeCloseTo(203.45, 2);
  });

  it("uses env overrides when set", () => {
    process.env.GALAXUS_STX_TARGET_NET_MARGIN = "0.11";
    process.env.GALAXUS_PRICE_SHIPPING_CHF = "3";
    expect(resolveGalaxusTargetNetMarginForSupplier("stx")).toBeCloseTo(0.11, 5);
    const stxSell = resolveGalaxusSellExVatForChannel(177, "stx", new Set());
    expect(stxSell).toBeCloseTo((177 + 3) / 0.89, 2);
  });

  it("does not apply STX margin to ner (zero-margin supplier)", () => {
    process.env.GALAXUS_TARGET_NET_MARGIN = "0.13";
    expect(resolveGalaxusTargetNetMarginForSupplier("ner")).toBeCloseTo(0.13, 5);
    const nerSell = resolveGalaxusSellExVatForChannel(100, "ner", new Set());
    expect(nerSell).toBeLessThanOrEqual(100.05);
    expect(nerSell).toBeGreaterThanOrEqual(100);
  });

  it("matches computeGalaxusSellPriceExVat for explicit inputs", () => {
    const buy = 151.07;
    const stxSell = resolveGalaxusSellExVatForChannel(buy, "stx", new Set());
    const direct = computeGalaxusSellPriceExVat({
      buyPriceExVatCHF: buy,
      shippingPerPairCHF: 2,
      targetNetMargin: 0.12,
      bufferPerPairCHF: 0,
      roundTo: 0.05,
    }).sellPriceExVatCHF;
    expect(stxSell).toBe(direct);
    expect(stxSell).toBeCloseTo(173.95, 2);
  });

  it("uses higher default shipping for WEL own-catalog lines", () => {
    const welSell = resolveGalaxusSellExVatForChannel(3, "wel", new Set());
    // (3 + 7 ship + 1 buffer) / (1 - 0.15) rounded up to 0.05 increment
    expect(welSell).toBe(12.95);
  });

  it("defaults WEL to at least 15% net + CHF 1 buffer", () => {
    expect(resolveGalaxusTargetNetMarginForSupplier("wel")).toBeCloseTo(0.15, 5);
    const welSell = resolveGalaxusSellExVatForChannel(24.9, "wel", new Set());
    // (24.9 + 7 + 1) / 0.85 = 38.705 → 38.75
    expect(welSell).toBe(38.75);
  });

  it("allows WEL shipping override via env", () => {
    process.env.GALAXUS_WEL_SHIPPING_CHF = "9";
    const welSell = resolveGalaxusSellExVatForChannel(3, "wel", new Set());
    // (3 + 9 + 1) / (1 - 0.15) rounded up to 0.05 increment
    expect(welSell).toBe(15.3);
  });

  it("allows WEL margin/buffer override via env (floor at 15% / CHF 1)", () => {
    process.env.GALAXUS_WEL_TARGET_NET_MARGIN = "0.12";
    process.env.GALAXUS_WEL_BUFFER_CHF = "0";
    expect(resolveGalaxusTargetNetMarginForSupplier("wel")).toBeCloseTo(0.15, 5);
    const welSell = resolveGalaxusSellExVatForChannel(3, "wel", new Set());
    // floor: (3 + 7 + 1) / 0.85 → 12.95
    expect(welSell).toBe(12.95);
  });

  it("allows higher WEL margin/buffer via env", () => {
    process.env.GALAXUS_WEL_TARGET_NET_MARGIN = "0.18";
    process.env.GALAXUS_WEL_BUFFER_CHF = "2";
    expect(resolveGalaxusTargetNetMarginForSupplier("wel")).toBeCloseTo(0.18, 5);
    const welSell = resolveGalaxusSellExVatForChannel(3, "wel", new Set());
    // (3 + 7 + 2) / 0.82 ≈ 14.634 → 14.65
    expect(welSell).toBe(14.65);
  });
});

describe("Galaxus GLD landed + 15% markup", () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    delete process.env.GALAXUS_GLD_TARGET_NET_MARGIN;
    delete process.env.GALAXUS_GLD_MARKUP;
    delete process.env.GALAXUS_GLD_SHIP_EUR;
    delete process.env.GALAXUS_GLD_SHIP_PAIRS;
    delete process.env.GALAXUS_GLD_DOUANE_EUR;
    delete process.env.GALAXUS_GLD_DOUANE_PAIRS;
    delete process.env.GALAXUS_GLD_EURCHF;
    delete process.env.GALAXUS_GLD_IMPORT_VAT;
    delete process.env.GALAXUS_PRICE_VAT_RATE;
    delete process.env.GALAXUS_PRICE_ROUND_TO;
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it("defaults to 15% markup + ship/douane extras", () => {
    expect(resolveGldMarkupFraction()).toBeCloseTo(0.15, 5);
    expect(resolveGldTargetNetMargin()).toBeCloseTo(0.15, 5);
    const extras = resolveGldLandedExtrasPerPairChf();
    // 100/10*0.94 + 20/10*0.94
    expect(extras.extrasPerPairChf).toBeCloseTo((100 / 10) * 0.94 + (20 / 10) * 0.94, 4);
  });

  it("sell = (buy + ship + CH VAT + douane) × 1.15 for golden/gld", () => {
    const buy = 62;
    const { shipPerPairChf, douanePerPairChf, importVatChf, landedChf } = resolveGldLandedCostChf(buy);
    expect(shipPerPairChf).toBeCloseTo((100 / 10) * 0.94, 4);
    expect(douanePerPairChf).toBeCloseTo((20 / 10) * 0.94, 4);
    expect(importVatChf).toBeCloseTo((buy + shipPerPairChf) * 0.081, 4);
    expect(landedChf).toBeCloseTo(buy + shipPerPairChf + importVatChf + douanePerPairChf, 6);

    const expected = Math.ceil((landedChf * 1.15 + 1e-12) * 20) / 20;
    expect(resolveGalaxusSellExVatForChannel(buy, "golden", new Set())).toBe(expected);
    expect(resolveGalaxusSellExVatForChannel(buy, "gld", new Set())).toBe(expected);
  });
});

