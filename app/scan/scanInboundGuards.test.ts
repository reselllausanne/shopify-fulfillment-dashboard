import { describe, expect, it } from "vitest";
import {
  isActiveStxInboundBuy,
  shouldAutoAddToPackingSession,
  shouldAutoGalaxusDirectLabelFor,
} from "./scanInboundGuards";

describe("isActiveStxInboundBuy", () => {
  it("false when no stxInboundBuy", () => {
    expect(isActiveStxInboundBuy({})).toBe(false);
    expect(isActiveStxInboundBuy(null)).toBe(false);
  });

  it("true when stxInboundBuy present and order not cancelled", () => {
    expect(
      isActiveStxInboundBuy({ stxInboundBuy: { orderCancelledAt: null } })
    ).toBe(true);
  });

  it("false when the parent Galaxus order was cancelled", () => {
    expect(
      isActiveStxInboundBuy({
        stxInboundBuy: { orderCancelledAt: "2026-08-31T10:00:00.000Z" },
      })
    ).toBe(false);
  });
});

describe("shouldAutoGalaxusDirectLabelFor", () => {
  it("prints for a linked direct-delivery Galaxus match", () => {
    expect(
      shouldAutoGalaxusDirectLabelFor({
        galaxus: { isDirectDelivery: true, allLinked: true },
      })
    ).toBe(true);
  });

  it("does not print when direct-delivery order is not fully linked yet", () => {
    expect(
      shouldAutoGalaxusDirectLabelFor({
        galaxus: { isDirectDelivery: true, allLinked: false },
      })
    ).toBe(false);
  });

  it("still auto-prints Galaxus direct label when inbound StockX AWB is present", () => {
    expect(
      shouldAutoGalaxusDirectLabelFor({
        galaxus: { isDirectDelivery: true, allLinked: true },
        stxInboundBuy: { orderCancelledAt: null, isDirectDelivery: true },
      })
    ).toBe(true);
  });

  it("still prints when the inbound buy's parent order is cancelled", () => {
    expect(
      shouldAutoGalaxusDirectLabelFor({
        galaxus: { isDirectDelivery: true, allLinked: true },
        stxInboundBuy: { orderCancelledAt: "2026-08-31T00:00:00.000Z" },
      })
    ).toBe(true);
  });
});

describe("shouldAutoAddToPackingSession", () => {
  it("adds when scan is a plain warehouse pair", () => {
    expect(shouldAutoAddToPackingSession({})).toBe(true);
  });

  it("adds when inbound StockX buy is for a warehouse Galaxus order", () => {
    expect(
      shouldAutoAddToPackingSession({
        stxInboundBuy: {
          orderCancelledAt: null,
          isWarehouse: true,
          isDirectDelivery: false,
        },
      })
    ).toBe(true);
  });

  it("does not add when inbound StockX buy is direct-delivery", () => {
    expect(
      shouldAutoAddToPackingSession({
        stxInboundBuy: {
          orderCancelledAt: null,
          isWarehouse: false,
          isDirectDelivery: true,
        },
      })
    ).toBe(false);
  });

  it("does not add when inbound delivery type is unknown (conservative)", () => {
    expect(
      shouldAutoAddToPackingSession({
        stxInboundBuy: { orderCancelledAt: null },
      })
    ).toBe(false);
  });
});
