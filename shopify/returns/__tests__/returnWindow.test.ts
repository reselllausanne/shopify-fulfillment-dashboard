import { describe, expect, it } from "vitest";
import {
  PUBLIC_RETURN_WINDOW_DAYS,
  buildFulfillmentLineDeliveryMap,
  filterReturnableLinesByWindow,
  isOutsideReturnWindow,
  resolveFulfillmentDeliveryAnchor,
} from "../returnWindow";

describe("returnWindow", () => {
  const now = new Date("2026-08-04T12:00:00.000Z");

  it("prefers deliveredAt over createdAt", () => {
    const anchor = resolveFulfillmentDeliveryAnchor({
      deliveredAt: "2026-07-20T10:00:00.000Z",
      createdAt: "2026-07-01T10:00:00.000Z",
    });
    expect(anchor?.toISOString()).toBe("2026-07-20T10:00:00.000Z");
  });

  it("falls back to createdAt when deliveredAt missing", () => {
    const anchor = resolveFulfillmentDeliveryAnchor({
      deliveredAt: null,
      createdAt: "2026-07-25T10:00:00.000Z",
    });
    expect(anchor?.toISOString()).toBe("2026-07-25T10:00:00.000Z");
  });

  it(`flags anchors older than ${PUBLIC_RETURN_WINDOW_DAYS} days`, () => {
    const inside = new Date("2026-07-22T12:00:00.000Z"); // 13 days
    const outside = new Date("2026-07-20T12:00:00.000Z"); // 15 days
    expect(isOutsideReturnWindow(inside, now)).toBe(false);
    expect(isOutsideReturnWindow(outside, now)).toBe(true);
    expect(isOutsideReturnWindow(null, now)).toBe(false);
  });

  it("filters expired fulfillment lines and keeps unknown/recent", () => {
    const map = buildFulfillmentLineDeliveryMap([
      {
        deliveredAt: "2026-07-01T00:00:00.000Z",
        fulfillmentLineItemIds: ["old-line"],
      },
      {
        deliveredAt: "2026-07-30T00:00:00.000Z",
        fulfillmentLineItemIds: ["new-line"],
      },
      {
        deliveredAt: null,
        createdAt: null,
        fulfillmentLineItemIds: ["unknown-line"],
      },
    ]);

    const { allowed, expired } = filterReturnableLinesByWindow(
      [
        { fulfillmentLineItemId: "old-line" },
        { fulfillmentLineItemId: "new-line" },
        { fulfillmentLineItemId: "unknown-line" },
      ],
      map,
      now
    );

    expect(expired.map((l) => l.fulfillmentLineItemId)).toEqual(["old-line"]);
    expect(allowed.map((l) => l.fulfillmentLineItemId)).toEqual(["new-line", "unknown-line"]);
  });
});
