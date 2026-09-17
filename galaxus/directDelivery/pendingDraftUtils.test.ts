import { describe, expect, it } from "vitest";
import {
  findPendingManualDraftForLine,
  isStaleManualDraftShipment,
} from "@/galaxus/directDelivery/pendingDraftUtils";

describe("findPendingManualDraftForLine", () => {
  it("finds REI order 200691393 stale MANUAL draft qty 3", () => {
    const orderId = "order-rei";
    const line = {
      id: "line-rei-1",
      buyerPid: "12212772",
      supplierPid: "REI_4058075270008",
      gtin: "4058075270008",
    };
    const items = [
      {
        orderId,
        shipmentId: "ship-draft",
        supplierPid: "REI_4058075270008",
        gtin14: "4058075270008",
        buyerPid: "12212772",
        quantity: 3,
        shipment: { delrSentAt: null, delrStatus: "PENDING", status: "MANUAL", trackingNumber: null },
      },
    ];
    expect(findPendingManualDraftForLine(orderId, line, items)).toEqual({
      shipmentDbId: "ship-draft",
      quantity: 3,
    });
  });

  it("ignores labeled MANUAL drafts with tracking", () => {
    expect(
      isStaleManualDraftShipment({
        status: "MANUAL",
        delrStatus: "PENDING",
        delrSentAt: null,
        trackingNumber: "996015781700005895",
      })
    ).toBe(false);
  });
});
