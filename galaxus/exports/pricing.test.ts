import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  calcGalaxusStxSellFromSourceCost,
  computeGalaxusSellPriceExVat,
  resolveGalaxusSellExVatForChannel,
  resolveGalaxusTargetNetMarginForSupplier,
  resolveGldLandedCostChf,
  resolveGldLandedExtrasPerPairChf,
  resolveGldMarkupFraction,
  resolveGldTargetNetMargin,
  GALAXUS_STX_FIXED_BOX_AND_SHIPPING_CHF,
  GALAXUS_STX_TARGET_CM2_RATE,
  GALAXUS_STX_VAT_FLAT_RATE,
  galaxusStxLockedDenom,
} from "@/galaxus/exports/pricing";

describe("Galaxus STX locked margin", () => {
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
    delete process.env.GALAXUS_BWZ_TARGET_NET_MARGIN;
    delete process.env.GALAXUS_BWZ_TARGET_MARGIN;
    delete process.env.GALAXUS_PRICE_BUFFER_CHF;
    delete process.env.GALAXUS_BUFFER_CHF;
    delete process.env.GALAXUS_PRICE_ROUND_TO;
    delete process.env.GALAXUS_ROUND_TO;
    delete process.env.GALAXUS_PRICE_VAT_RATE;
    delete process.env.GALAXUS_VAT_RATE;
    delete process.env.GALAXUS_STX_TARGET_NET_MARGIN;
    delete process.env.GALAXUS_STX_MARGIN_ADJUSTMENT;
    delete process.env.GALAXUS_STX_DD_SHIPPING_CHF;
    delete process.env.GALAXUS_STX_DIRECT_DELIVERY_SHIPPING_CHF;
    delete process.env.GALAXUS_STX_PRICE_BUMP_CHF;
    delete process.env.GALAXUS_STX_PRICE_SURCHARGE_CHF;
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

  it("exposes locked STX constants (12.3% total rate)", () => {
    expect(GALAXUS_STX_FIXED_BOX_AND_SHIPPING_CHF).toBe(1.6);
    expect(GALAXUS_STX_VAT_FLAT_RATE).toBe(0.023);
    expect(GALAXUS_STX_TARGET_CM2_RATE).toBe(0.1);
    expect(galaxusStxLockedDenom()).toBeCloseTo(0.877, 6);
    expect(resolveGalaxusTargetNetMarginForSupplier("stx")).toBeCloseTo(0.1, 5);
  });

  it("sell = (buy + 1.60) / (1 - 0.123) ceil centime", () => {
    expect(calcGalaxusStxSellFromSourceCost(177)).toBe(203.65);
    expect(resolveGalaxusSellExVatForChannel(177, "stx", new Set())).toBe(203.65);
    expect(calcGalaxusStxSellFromSourceCost(180.08)).toBe(207.17);
  });

  it("standard and express STX use same locked ship (no DD premium)", () => {
    const buy = 100;
    const standard = resolveGalaxusSellExVatForChannel(buy, "stx", new Set(), {
      deliveryType: "standard",
    });
    const express = resolveGalaxusSellExVatForChannel(buy, "stx", new Set(), {
      deliveryType: "express_standard",
    });
    expect(standard).toBe(115.85);
    expect(express).toBe(115.85);
  });

  it("ignores STX bump / margin / DD env overrides", () => {
    process.env.GALAXUS_STX_PRICE_BUMP_CHF = "8";
    process.env.GALAXUS_STX_TARGET_NET_MARGIN = "0.11";
    process.env.GALAXUS_PRICE_SHIPPING_CHF = "3";
    process.env.GALAXUS_STX_DD_SHIPPING_CHF = "11";
    expect(resolveGalaxusTargetNetMarginForSupplier("stx")).toBeCloseTo(0.1, 5);
    expect(resolveGalaxusSellExVatForChannel(177, "stx", new Set())).toBe(203.65);
    expect(
      resolveGalaxusSellExVatForChannel(100, "stx", new Set(), {
        deliveryType: "express_expedited",
      })
    ).toBe(115.85);
  });

  it("does not apply STX margin to ner (zero-margin supplier)", () => {
    process.env.GALAXUS_TARGET_NET_MARGIN = "0.13";
    expect(resolveGalaxusTargetNetMarginForSupplier("ner")).toBeCloseTo(0.13, 5);
    const nerSell = resolveGalaxusSellExVatForChannel(100, "ner", new Set());
    expect(nerSell).toBeLessThanOrEqual(100.05);
    expect(nerSell).toBeGreaterThanOrEqual(100);
    expect(resolveGalaxusSellExVatForChannel(108.88, "rei", new Set())).toBeCloseTo(108.9, 2);
    expect(resolveGalaxusSellExVatForChannel(99, "wrk", new Set())).toBeCloseTo(99, 1);
  });

  it("legacy computeGalaxusSellPriceExVat still available for non-STX", () => {
    const buy = 151.07;
    const direct = computeGalaxusSellPriceExVat({
      buyPriceExVatCHF: buy,
      shippingPerPairCHF: 2,
      targetNetMargin: 0.12,
      bufferPerPairCHF: 0,
      roundTo: 0.05,
    }).sellPriceExVatCHF;
    expect(direct).toBeCloseTo(173.95, 2);
  });

  it("uses higher default shipping for WEL own-catalog lines", () => {
    const welSell = resolveGalaxusSellExVatForChannel(3, "wel", new Set());
    expect(welSell).toBe(12.95);
  });

  it("defaults WEL to at least 15% net + CHF 1 buffer", () => {
    expect(resolveGalaxusTargetNetMarginForSupplier("wel")).toBeCloseTo(0.15, 5);
  });

  it("allows WEL shipping override via env", () => {
    process.env.GALAXUS_WEL_SHIPPING_CHF = "4";
    const welSell = resolveGalaxusSellExVatForChannel(3, "wel", new Set());
    // (3 + 4 + 1) / 0.85 → 9.411 → round up 0.05 → 9.45
    expect(welSell).toBe(9.45);
  });

  it("WEL never goes below 15% even if env lower", () => {
    process.env.GALAXUS_WEL_TARGET_NET_MARGIN = "0.12";
    expect(resolveGalaxusTargetNetMarginForSupplier("wel")).toBeCloseTo(0.15, 5);
  });

  it("allows WEL higher explicit margin", () => {
    process.env.GALAXUS_WEL_TARGET_NET_MARGIN = "0.18";
    expect(resolveGalaxusTargetNetMarginForSupplier("wel")).toBeCloseTo(0.18, 5);
  });

  it("defaults BWZ to at least 15% net (default ship CHF 2)", () => {
    expect(resolveGalaxusTargetNetMarginForSupplier("bwz")).toBeCloseTo(0.15, 5);
    const sell = resolveGalaxusSellExVatForChannel(100, "bwz", new Set());
    expect(sell).toBeCloseTo((100 + 2) / 0.85, 1);
  });

  it("BWZ floor 15% / allows higher", () => {
    process.env.GALAXUS_BWZ_TARGET_NET_MARGIN = "0.12";
    expect(resolveGalaxusTargetNetMarginForSupplier("bwz")).toBeCloseTo(0.15, 5);
    process.env.GALAXUS_BWZ_TARGET_NET_MARGIN = "0.18";
    expect(resolveGalaxusTargetNetMarginForSupplier("bwz")).toBeCloseTo(0.18, 5);
  });
});

describe("Galaxus GLD landed markup", () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
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

  it("defaults to 15% markup + ship/douane extras", () => {
    expect(resolveGldMarkupFraction()).toBeCloseTo(0.15, 5);
    expect(resolveGldTargetNetMargin()).toBeCloseTo(0.15, 5);
    const extras = resolveGldLandedExtrasPerPairChf();
    expect(extras.shipPerPairChf).toBeCloseTo((100 / 10) * 0.94, 4);
  });

  it("sell = (buy + ship + CH VAT + douane) × 1.15 for golden/gld", () => {
    const buy = 80;
    const { shipPerPairChf, douanePerPairChf, importVatChf, landedChf } = resolveGldLandedCostChf(buy);
    expect(shipPerPairChf).toBeCloseTo((100 / 10) * 0.94, 4);
    expect(importVatChf).toBeCloseTo((buy + shipPerPairChf) * 0.081, 4);
    expect(landedChf).toBeCloseTo(buy + shipPerPairChf + importVatChf + douanePerPairChf, 6);
    const sell = resolveGalaxusSellExVatForChannel(buy, "gld", new Set());
    expect(sell).toBeGreaterThan(landedChf);
  });
});
