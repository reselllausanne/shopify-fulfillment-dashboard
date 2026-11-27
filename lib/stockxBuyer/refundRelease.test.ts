import { describe, expect, it } from "vitest";
import {
  boughtStateReleasedByRefund,
  isTerminalStockxBuyStatus,
  keysReleasedByRefund,
  linkedBuyBlocksNewPurchase,
} from "@/lib/stockxBuyer/refundRelease";

describe("refund releases a linked line", () => {
  it("treats cancelled and refunded as terminal, and a live status as active", () => {
    expect(isTerminalStockxBuyStatus("CANCELLED")).toBe(true);
    expect(isTerminalStockxBuyStatus("REFUNDED")).toBe(true);
    expect(isTerminalStockxBuyStatus("Order Refunded")).toBe(true);
    expect(isTerminalStockxBuyStatus("SELLER_SHIPPED")).toBe(false);
    expect(isTerminalStockxBuyStatus("ORDER_CREATED")).toBe(false);
    expect(isTerminalStockxBuyStatus(null)).toBe(false);
    expect(isTerminalStockxBuyStatus("")).toBe(false);
  });

  it("blocks a second buy while the linked order is still active", () => {
    expect(linkedBuyBlocksNewPurchase({ stockxOrderNumber: "03-LIVE", stockxStatus: "ORDER_CREATED" })).toBe(true);
    expect(linkedBuyBlocksNewPurchase({ stockxOrderNumber: "03-LIVE", stockxStatus: null })).toBe(true);
    expect(linkedBuyBlocksNewPurchase({ stockxOrderNumber: "03-LIVE", stockxStatus: "" })).toBe(true);
    expect(linkedBuyBlocksNewPurchase({ stockxOrderNumber: "", stockxStatus: "CANCELLED" })).toBe(false);
    expect(linkedBuyBlocksNewPurchase(null)).toBe(false);
  });

  it("releases the line when that same StockX number was refunded or cancelled", () => {
    const bought = { status: "bought", stockxOrderNumber: "03-WPN3H3QYRR" };
    expect(boughtStateReleasedByRefund(bought, { stockxOrderNumber: "03-WPN3H3QYRR", stockxStatus: "CANCELLED" })).toBe(
      true
    );
    expect(boughtStateReleasedByRefund(bought, { stockxOrderNumber: "03-WPN3H3QYRR", stockxStatus: "REFUNDED" })).toBe(
      true
    );
    expect(
      boughtStateReleasedByRefund(bought, { stockxOrderNumber: "03-WPN3H3QYRR", stockxStatus: "SELLER_SHIPPED" })
    ).toBe(false);
  });

  it("does not release when a different order is the one that is terminal", () => {
    const bought = { status: "bought", stockxOrderNumber: "03-NEW" };
    expect(boughtStateReleasedByRefund(bought, { stockxOrderNumber: "03-OLD", stockxStatus: "REFUNDED" })).toBe(false);
  });

  it("does not release a non-bought state", () => {
    expect(
      boughtStateReleasedByRefund(
        { status: "too_expensive", stockxOrderNumber: "03-X" },
        { stockxOrderNumber: "03-X", stockxStatus: "REFUNDED" }
      )
    ).toBe(false);
  });

  it("releases only the matching pair key", () => {
    const keys = keysReleasedByRefund(
      {
        "line-a:0": { status: "bought", stockxOrderNumber: "03-WPN3H3QYRR" },
        "line-b:0": { status: "bought", stockxOrderNumber: "03-LIVE" },
      },
      [
        { key: "line-a:0", stockxOrderNumber: "03-WPN3H3QYRR", stockxStatus: "CANCELLED" },
        { key: "line-b:0", stockxOrderNumber: "03-LIVE", stockxStatus: "ORDER_CREATED" },
      ]
    );
    expect(keys).toEqual(["line-a:0"]);
  });
});
