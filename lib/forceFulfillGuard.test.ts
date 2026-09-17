import { describe, expect, it } from "vitest";
import {
  assertForceFulfillDisabled,
  resolveFulfillLineItems,
} from "@/lib/forceFulfillGuard";

describe("forceFulfillGuard", () => {
  it("rejects allowAlreadyFulfilled=true with FORCE_FULFILL_DISABLED", () => {
    const r = assertForceFulfillDisabled(true);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe("FORCE_FULFILL_DISABLED");
      expect(r.statusCode).toBe(403);
    }
  });

  it("allows allowAlreadyFulfilled=false", () => {
    expect(assertForceFulfillDisabled(false).ok).toBe(true);
    expect(assertForceFulfillDisabled(undefined).ok).toBe(true);
  });

  it("allowAlreadyFulfilled=true never yields allRemainingLineItems", () => {
    const matched = [
      {
        fulfillmentOrderId: "fo1",
        fulfillmentOrderLineItems: [{ id: "li1", quantity: 1 }],
      },
    ];
    const allRemaining = [
      {
        fulfillmentOrderId: "fo1",
        fulfillmentOrderLineItems: [
          { id: "li1", quantity: 1 },
          { id: "li2", quantity: 2 },
        ],
      },
    ];
    const resolved = resolveFulfillLineItems({
      allowAlreadyFulfilled: true,
      matchedLineItemsByFulfillmentOrder: matched,
      allRemainingLineItems: allRemaining,
    });
    expect(resolved.usedAllRemaining).toBe(false);
    expect(resolved.lineItemsByFulfillmentOrder).toEqual(matched);
    expect(resolved.lineItemsByFulfillmentOrder).not.toEqual(allRemaining);
    const totalQty = resolved.lineItemsByFulfillmentOrder.flatMap(
      (fo) => fo.fulfillmentOrderLineItems
    ).reduce((n, li) => n + li.quantity, 0);
    expect(totalQty).toBe(1);
  });
});
