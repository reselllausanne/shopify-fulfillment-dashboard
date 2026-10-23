import { describe, expect, it } from "vitest";
import { SERVER_PURCHASE_PIXEL_VERSION } from "./serverPurchase";

describe("serverPurchase", () => {
  it("exports a distinct pixel version for shadow reports", () => {
    expect(SERVER_PURCHASE_PIXEL_VERSION).toBe("server.orders_paid");
  });
});
