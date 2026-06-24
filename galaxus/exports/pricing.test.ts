import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  computeGalaxusSellPriceExVat,
  resolveGalaxusSellExVatForChannel,
  resolveGalaxusTargetNetMarginForSupplier,
} from "@/galaxus/exports/pricing";

describe("Galaxus STX margin adjustment", () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    process.env.GALAXUS_TARGET_NET_MARGIN = "0.13";
    process.env.GALAXUS_PRICE_SHIPPING_CHF = "6";
    process.env.GALAXUS_PRICE_BUFFER_CHF = "1";
    process.env.GALAXUS_PRICE_ROUND_TO = "0.05";
    delete process.env.GALAXUS_STX_TARGET_NET_MARGIN;
    delete process.env.GALAXUS_STX_MARGIN_ADJUSTMENT;
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it("applies -1pp to STX only (13% -> 12%)", () => {
    expect(resolveGalaxusTargetNetMarginForSupplier("stx")).toBeCloseTo(0.12, 5);
    expect(resolveGalaxusTargetNetMarginForSupplier("ner")).toBeCloseTo(0.13, 5);
    expect(resolveGalaxusTargetNetMarginForSupplier(null)).toBeCloseTo(0.13, 5);
  });

  it("lowers STX sell price vs default margin path", () => {
    const partners = new Set(["ner", "flo"]);
    const buy = 151.07;
    const stxSell = resolveGalaxusSellExVatForChannel(buy, "stx", partners);
    const defaultSell = computeGalaxusSellPriceExVat({
      buyPriceExVatCHF: buy,
      shippingPerPairCHF: 6,
      targetNetMargin: 0.13,
      bufferPerPairCHF: 1,
      roundTo: 0.05,
    }).sellPriceExVatCHF;
    expect(stxSell).toBeLessThan(defaultSell);
    expect(stxSell).toBeCloseTo(179.65, 2);
  });

  it("respects explicit GALAXUS_STX_TARGET_NET_MARGIN override", () => {
    process.env.GALAXUS_STX_TARGET_NET_MARGIN = "0.11";
    expect(resolveGalaxusTargetNetMarginForSupplier("stx")).toBeCloseTo(0.11, 5);
  });
});
