import { describe, expect, it } from "vitest";
import {
  resolveSwissPostPrzl,
  shouldSkipSwissPostLabelForLiquidation,
} from "@/lib/swissPostShipping";

function orderInfo(input: {
  gateways?: string[];
  totalChf?: number;
}) {
  return {
    id: "gid://shopify/Order/1",
    name: "#1",
    paymentGatewayNames: input.gateways ?? [],
    lineItems: { nodes: [] },
    orderTotal:
      input.totalChf != null
        ? { amount: String(input.totalChf), currencyCode: "CHF" }
        : undefined,
  } as any;
}

describe("resolveSwissPostPrzl", () => {
  it("standard → ECO", () => {
    expect(resolveSwissPostPrzl({ orderInfo: orderInfo({}), deliveryMode: "standard" }).przl).toEqual([
      "ECO",
    ]);
  });

  it("express → PRI (A-Post)", () => {
    expect(resolveSwissPostPrzl({ orderInfo: orderInfo({}), deliveryMode: "express" }).przl).toEqual([
      "PRI",
    ]);
  });

  it("facture/powerpay → SI + ECO", () => {
    expect(
      resolveSwissPostPrzl({
        orderInfo: orderInfo({
          gateways: ["Pay by Invoice / Pay later (with Powerpay)"],
        }),
        deliveryMode: "standard",
      }).przl
    ).toEqual(["SI", "ECO"]);
  });

  it("express + facture → SI + PRI", () => {
    expect(
      resolveSwissPostPrzl({
        orderInfo: orderInfo({
          gateways: ["Pay by Invoice / Pay later (with Powerpay)"],
        }),
        deliveryMode: "express",
      }).przl
    ).toEqual(["SI", "PRI"]);
  });

  it("high-value (>450 CHF) forces SI", () => {
    expect(
      resolveSwissPostPrzl({
        orderInfo: orderInfo({ totalChf: 500 }),
        deliveryMode: "express",
      }).przl
    ).toEqual(["SI", "PRI"]);
  });
});

describe("shouldSkipSwissPostLabelForLiquidation", () => {
  it("skips when all titles are liquidation", () => {
    expect(shouldSkipSwissPostLabelForLiquidation(["Nike Dunk 20%"])).toBe(true);
    expect(shouldSkipSwissPostLabelForLiquidation(["Jordan % - 42"])).toBe(true);
  });

  it("does not skip normal titles", () => {
    expect(shouldSkipSwissPostLabelForLiquidation(["Nike Air Max Plus"])).toBe(false);
    expect(shouldSkipSwissPostLabelForLiquidation(["100% cotton tee"])).toBe(false);
  });
});
