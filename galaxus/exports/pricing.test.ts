import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  computeGalaxusSellPriceExVat,
  resolveGalaxusSellExVatForChannel,
  resolveGalaxusTargetNetMarginForSupplier,
} from "@/galaxus/exports/pricing";

describe("Galaxus STX margin", () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    delete process.env.GALAXUS_TARGET_NET_MARGIN;
    delete process.env.GALAXUS_TARGET_MARGIN;
    delete process.env.GALAXUS_PRICE_SHIPPING_CHF;
    delete process.env.GALAXUS_PRICE_BUFFER_CHF;
    delete process.env.GALAXUS_STX_TARGET_NET_MARGIN;
    delete process.env.GALAXUS_STX_MARGIN_ADJUSTMENT;
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
});
