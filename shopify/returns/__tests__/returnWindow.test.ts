import { describe, expect, it } from "vitest";
import {
  PUBLIC_RETURN_WINDOW_DAYS,
  addBusinessDays,
  buildFulfillmentLineDeliveryMap,
  filterReturnableLinesByWindow,
  isOutsideReturnWindow,
  resolveFulfillmentDeliveryAnchor,
} from "../returnWindow";

describe("returnWindow", () => {
  const now = new Date("2026-08-04T12:00:00.000Z");

  it("prefers deliveredAt over fulfilled+3bd", () => {
    const anchor = resolveFulfillmentDeliveryAnchor({
      deliveredAt: "2026-07-20T10:00:00.000Z",
      createdAt: "2026-07-01T10:00:00.000Z",
    });
    expect(anchor?.toISOString()).toBe("2026-07-20T10:00:00.000Z");
  });

  it("adds 3 business days to fulfilledAt when deliveredAt missing", () => {
    // Wed 22 Jul → +3bd = Mon 27 Jul
    const anchor = resolveFulfillmentDeliveryAnchor({
      deliveredAt: null,
      createdAt: "2026-07-22T06:52:45.000Z",
    });
    expect(anchor?.toISOString()).toBe("2026-07-27T06:52:45.000Z");
  });

  it("skips weekends when adding business days", () => {
    // Fri 24 Jul → Sat/Sun skip → Mon Tue Wed = 29 Jul
    const next = addBusinessDays(new Date("2026-07-24T12:00:00.000Z"), 3);
    expect(next.toISOString()).toBe("2026-07-29T12:00:00.000Z");
  });

  it(`flags anchors older than ${PUBLIC_RETURN_WINDOW_DAYS} days`, () => {
    const inside = new Date("2026-07-22T12:00:00.000Z"); // 13 days
    const outside = new Date("2026-07-20T12:00:00.000Z"); // 15 days
    expect(isOutsideReturnWindow(inside, now)).toBe(false);
    expect(isOutsideReturnWindow(outside, now)).toBe(true);
    expect(isOutsideReturnWindow(null, now)).toBe(false);
  });

  it("filters expired lines; unknown stays allowed", () => {
    const map = buildFulfillmentLineDeliveryMap([
      {
        deliveredAt: "2026-07-01T00:00:00.000Z",
        fulfillmentLineItemIds: ["old-line"],
      },
      {
        // Fulfilled Jul 10 → +3bd Jul 15 → outside 14d from Aug 4
        deliveredAt: null,
        createdAt: "2026-07-10T00:00:00.000Z",
        fulfillmentLineItemIds: ["old-fulfilled"],
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
        { fulfillmentLineItemId: "old-fulfilled" },
        { fulfillmentLineItemId: "new-line" },
        { fulfillmentLineItemId: "unknown-line" },
      ],
      map,
      now
    );

    expect(expired.map((l) => l.fulfillmentLineItemId).sort()).toEqual([
      "old-fulfilled",
      "old-line",
    ]);
    expect(allowed.map((l) => l.fulfillmentLineItemId).sort()).toEqual([
      "new-line",
      "unknown-line",
    ]);
  });
});
