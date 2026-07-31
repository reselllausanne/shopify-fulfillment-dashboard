import { afterEach, describe, expect, it } from "vitest";
import {
  calcLiquidationExpressSellPrice,
  parseExpressPriceMetafieldAmount,
  readLiquidationExpressSurchargeChf,
} from "@/shopify/restock/liquidationExpressPrice";

describe("liquidationExpressPrice", () => {
  const prevSurcharge = process.env.LIQUIDATION_EXPRESS_SURCHARGE_CHF;

  afterEach(() => {
    if (prevSurcharge === undefined) {
      delete process.env.LIQUIDATION_EXPRESS_SURCHARGE_CHF;
    } else {
      process.env.LIQUIDATION_EXPRESS_SURCHARGE_CHF = prevSurcharge;
    }
  });

  it("defaults surcharge to 20 CHF", () => {
    delete process.env.LIQUIDATION_EXPRESS_SURCHARGE_CHF;
    expect(readLiquidationExpressSurchargeChf()).toBe(20);
  });

  it("calcLiquidationExpressSellPrice adds surcharge", () => {
    process.env.LIQUIDATION_EXPRESS_SURCHARGE_CHF = "20";
    expect(calcLiquidationExpressSellPrice(129.9)).toBe(149.9);
  });

  it("parseExpressPriceMetafieldAmount reads money JSON", () => {
    expect(
      parseExpressPriceMetafieldAmount('{"amount":"149.90","currency_code":"CHF"}')
    ).toBe(149.9);
  });

  it("parseExpressPriceMetafieldAmount reads cent integer", () => {
    expect(parseExpressPriceMetafieldAmount("14990")).toBe(149.9);
  });
});
