import { describe, expect, it } from "vitest";
import {
  countOpenDirectLines,
  isActiveStxInboundBuy,
  shouldAutoAddToPackingSession,
  shouldAutoGalaxusDirectLabelFor,
  shouldAutoStxInboundDirectFulfill,
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

  it("defers galaxus auto-label to inbound direct fulfill when StockX AWB is present", () => {
    expect(
      shouldAutoGalaxusDirectLabelFor({
        galaxus: { isDirectDelivery: true, allLinked: true },
        stxInboundBuy: { orderCancelledAt: null, isDirectDelivery: true },
      })
    ).toBe(false);
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

describe("shouldAutoStxInboundDirectFulfill", () => {
  it("true for active direct inbound buy", () => {
    expect(
      shouldAutoStxInboundDirectFulfill({
        stxInboundBuy: { orderCancelledAt: null, isDirectDelivery: true },
      })
    ).toBe(true);
  });

  it("false for warehouse inbound", () => {
    expect(
      shouldAutoStxInboundDirectFulfill({
        stxInboundBuy: { orderCancelledAt: null, isWarehouse: true, isDirectDelivery: false },
      })
    ).toBe(false);
  });
});

describe("countOpenDirectLines", () => {
  it("counts lines with remaining qty", () => {
    expect(
      countOpenDirectLines([
        { quantity: 1, remaining: 1 },
        { quantity: 1, remaining: 0 },
      ])
    ).toBe(1);
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
