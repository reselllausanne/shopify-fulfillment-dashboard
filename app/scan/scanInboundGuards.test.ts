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
  it("prints for a direct-delivery match with known scanned lineId", () => {
    expect(
      shouldAutoGalaxusDirectLabelFor({
        galaxus: { isDirectDelivery: true, allLinked: true, lineId: "line-1" },
      })
    ).toBe(true);
  });

  it("prints even when siblings are not fully linked yet (partial ship)", () => {
    expect(
      shouldAutoGalaxusDirectLabelFor({
        galaxus: { isDirectDelivery: true, allLinked: false, lineId: "line-1" },
      })
    ).toBe(true);
  });

  it("does not print when direct-delivery but no lineId (would ship whole order)", () => {
    expect(
      shouldAutoGalaxusDirectLabelFor({
        galaxus: { isDirectDelivery: true, allLinked: true },
      })
    ).toBe(false);
  });

  it("still auto-prints Galaxus direct label when inbound StockX AWB is present", () => {
    expect(
      shouldAutoGalaxusDirectLabelFor({
        galaxus: { isDirectDelivery: true, allLinked: true, lineId: "line-1" },
        stxInboundBuy: { orderCancelledAt: null, isDirectDelivery: true },
      })
    ).toBe(true);
  });

  it("uses stxInboundBuy.lineId when galaxus payload omits it", () => {
    expect(
      shouldAutoGalaxusDirectLabelFor({
        galaxus: { isDirectDelivery: true, allLinked: true },
        stxInboundBuy: {
          orderCancelledAt: null,
          isDirectDelivery: true,
          lineId: "line-from-unit",
        },
      })
    ).toBe(true);
  });

  it("still prints when the inbound buy's parent order is cancelled", () => {
    expect(
      shouldAutoGalaxusDirectLabelFor({
        galaxus: { isDirectDelivery: true, allLinked: true, lineId: "line-1" },
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
