import { describe, expect, it } from "vitest";
import {
  normalizeStockxBuyOrderNumber,
  terminalStatusFromBuyingNode,
} from "@/lib/stockxHistoricalCancelSync";

describe("terminalStatusFromBuyingNode", () => {
  it("reads CANCELLED from statusKey", () => {
    expect(
      terminalStatusFromBuyingNode({ state: { statusKey: "CANCELLED", statusTitle: "Order Canceled" } })
    ).toBe("CANCELLED");
  });

  it("reads cancel from statusTitle when key empty", () => {
    expect(
      terminalStatusFromBuyingNode({ state: { statusKey: "", statusTitle: "Order Canceled" } })
    ).toBe("CANCELLED");
  });

  it("reads REFUNDED", () => {
    expect(terminalStatusFromBuyingNode({ state: { statusKey: "REFUNDED" } })).toBe("REFUNDED");
  });

  it("ignores in-progress statuses", () => {
    expect(terminalStatusFromBuyingNode({ state: { statusKey: "AC_RECEIVED" } })).toBeNull();
    expect(terminalStatusFromBuyingNode({ state: { statusKey: "ORDER_CREATED" } })).toBeNull();
  });
});

describe("normalizeStockxBuyOrderNumber", () => {
  it("trims and uppercases", () => {
    expect(normalizeStockxBuyOrderNumber(" 03-jcpn97x6yu ")).toBe("03-JCPN97X6YU");
  });
});
