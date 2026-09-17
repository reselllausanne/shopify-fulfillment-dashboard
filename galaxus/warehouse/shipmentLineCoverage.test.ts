import { describe, expect, it } from "vitest";
import {
  computeShipmentCoverageForOrders,
  directDeliveryMultiGtinShipmentIds,
  isStaleManualDraftShipment,
  isUnfinalizedDraftShipment,
  selectDraftShipmentsToPurge,
  selectStaleManualDraftsToPurge,
} from "@/galaxus/warehouse/shipmentLineCoverage";

describe("directDeliveryMultiGtinShipmentIds", () => {
  it("flags shipments that mix multiple GTINs on one direct order", () => {
    const invalid = directDeliveryMultiGtinShipmentIds("order-1", [
      { orderId: "order-1", shipmentId: "ship-a", gtin14: "197298362047" },
      { orderId: "order-1", shipmentId: "ship-a", gtin14: "197298362054" },
      { orderId: "order-1", shipmentId: "ship-b", gtin14: "197298362054" },
    ]);
    expect(invalid.has("ship-a")).toBe(true);
    expect(invalid.has("ship-b")).toBe(false);
  });
});

describe("computeShipmentCoverageForOrders direct delivery", () => {
  it("ignores invalid multi-GTIN direct bundles when computing remaining", () => {
    const order = {
      id: "order-1",
      galaxusOrderId: "201559842",
      deliveryType: "direct_delivery",
      lines: [
        { id: "line-39", quantity: 1, gtin: "197298362047", supplierPid: "STX_197298362047" },
        { id: "line-395", quantity: 1, gtin: "197298362054", supplierPid: "STX_197298362054" },
      ],
    };
    const items = [
      {
        orderId: "order-1",
        shipmentId: "ship-a",
        gtin14: "197298362047",
        supplierPid: "STX_197298362047",
        quantity: 1,
        shipment: { delrSentAt: new Date(), delrStatus: "UPLOADED", status: "FULFILLED" },
      },
      {
        orderId: "order-1",
        shipmentId: "ship-a",
        gtin14: "197298362054",
        supplierPid: "STX_197298362054",
        quantity: 1,
        shipment: { delrSentAt: new Date(), delrStatus: "UPLOADED", status: "FULFILLED" },
      },
    ];
    const coverage = computeShipmentCoverageForOrders([order], items, new Set(["ship-a"]));
    expect(coverage["line-39"]?.remaining).toBe(1);
    expect(coverage["line-395"]?.remaining).toBe(1);
  });

  it("REI direct qty 5: unfinalized MANUAL draft blocks until purged on confirmReplace", () => {
    const order = {
      id: "order-rei",
      galaxusOrderId: "200691393",
      deliveryType: "direct_delivery",
      lines: [
        {
          id: "line-rei-1",
          quantity: 5,
          gtin: "4058075270008",
          supplierPid: "REI_4058075270008",
          buyerPid: "12212772",
        },
      ],
    };
    const draftItem = {
      orderId: "order-rei",
      shipmentId: "ship-draft",
      supplierPid: "REI_4058075270008",
      gtin14: "4058075270008",
      buyerPid: "12212772",
      quantity: 5,
      shipment: { delrSentAt: null, delrStatus: "PENDING", status: "MANUAL" },
    };

    const blocked = computeShipmentCoverageForOrders([order], [draftItem], new Set());
    expect(blocked["line-rei-1"]).toEqual({ ordered: 5, shipped: 0, reserved: 5, remaining: 0 });

    const purged = computeShipmentCoverageForOrders([order], [], new Set());
    expect(purged["line-rei-1"]).toEqual({ ordered: 5, shipped: 0, reserved: 0, remaining: 5 });
  });

  it("REI direct qty 5: partial MANUAL draft leaves correct remaining for next pack", () => {
    const order = {
      id: "order-rei",
      galaxusOrderId: "200691393",
      deliveryType: "direct_delivery",
      lines: [
        {
          id: "line-rei-1",
          quantity: 5,
          gtin: "4058075270008",
          supplierPid: "REI_4058075270008",
          buyerPid: "12212772",
        },
      ],
    };
    const draftItem = {
      orderId: "order-rei",
      shipmentId: "ship-draft",
      supplierPid: "REI_4058075270008",
      gtin14: "4058075270008",
      buyerPid: "12212772",
      quantity: 3,
      shipment: { delrSentAt: null, delrStatus: "PENDING", status: "MANUAL" },
    };

    const coverage = computeShipmentCoverageForOrders([order], [draftItem], new Set());
    expect(coverage["line-rei-1"]?.remaining).toBe(2);
    expect(coverage["line-rei-1"]?.reserved).toBe(3);
  });
});

describe("selectDraftShipmentsToPurge", () => {
  it("drops only non-MANUAL unfinalized drafts upfront", () => {
    const manualDraft = {
      id: "s-manual",
      status: "MANUAL",
      delrStatus: "PENDING",
      delrSentAt: null,
    };
    const autoDraft = {
      id: "s-auto",
      status: "DRAFT",
      delrStatus: "PENDING",
      delrSentAt: null,
    };
    const finalized = {
      id: "s-final",
      status: "MANUAL",
      delrStatus: "UPLOADED",
      delrSentAt: new Date(),
    };

    expect(selectDraftShipmentsToPurge([manualDraft, autoDraft, finalized], false)).toEqual(["s-auto"]);
    expect(selectDraftShipmentsToPurge([manualDraft, autoDraft, finalized], true)).toEqual(["s-auto"]);
    expect(isUnfinalizedDraftShipment(finalized)).toBe(false);
    expect(isUnfinalizedDraftShipment(manualDraft)).toBe(true);
  });
});

describe("selectStaleManualDraftsToPurge", () => {
  it("drops MANUAL drafts without tracking (label never applied)", () => {
    const stale = {
      id: "s-stale",
      status: "MANUAL",
      delrStatus: "PENDING",
      delrSentAt: null,
      trackingNumber: null,
    };
    const labeled = {
      id: "s-labeled",
      status: "MANUAL",
      delrStatus: "PENDING",
      delrSentAt: null,
      trackingNumber: "996015781700005895",
    };
    expect(isStaleManualDraftShipment(stale)).toBe(true);
    expect(isStaleManualDraftShipment(labeled)).toBe(false);
    expect(selectStaleManualDraftsToPurge([stale, labeled])).toEqual(["s-stale"]);
  });
});
