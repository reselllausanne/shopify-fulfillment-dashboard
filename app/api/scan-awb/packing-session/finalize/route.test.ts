import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.fn();
const createCompositeMock = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    galaxusOrder: { findMany: findManyMock },
    document: { findFirst: vi.fn(), create: vi.fn() },
    shipment: { findUnique: vi.fn() },
  },
}));

vi.mock("@/galaxus/warehouse/shipments", () => ({
  createCompositeWarehouseShipment: createCompositeMock,
}));

vi.mock("@/galaxus/directDelivery/swissPostLabelFlow", () => ({
  applySuccessfulSwissPostLabelToShipment: vi.fn(),
  extractLabelPayload: vi.fn(),
  requestSwissPostLabelForOrderWithTrackingHint: vi.fn(),
}));

vi.mock("@/galaxus/directDelivery/runDirectSwissPostLabel", () => ({
  resolveBrowserPrintConfig: vi.fn(() => ({ widthMm: 100, heightMm: 150 })),
}));

vi.mock("@/lib/printEnv", () => ({
  isLocalStation: vi.fn(() => false),
  maybePrintLabelLocally: vi.fn(),
}));

describe("scan packing-session finalize delivery-note guard", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns 409 when delivery note required without confirmation", async () => {
    findManyMock.mockResolvedValueOnce([
      {
        id: "db-order-1",
        galaxusOrderId: "GX-1001",
        orderNumber: "1001",
        orderDate: new Date("2026-09-01T10:00:00.000Z"),
        physicalDeliveryNoteRequired: true,
        recipientPostalCode: "1000",
        recipientAddress1: "Street 1",
        recipientCity: "Lausanne",
      },
    ]);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/scan-awb/packing-session/finalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entries: [{ galaxusOrderDbId: "db-order-1", galaxusOrderLineId: "line-1" }],
      }),
    });

    const res = await POST(req as any);
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.ok).toBe(false);
    expect(data.code).toBe("DELIVERY_NOTE_CONFIRMATION_REQUIRED");
    expect(data.deliveryNoteRequirement).toEqual({
      required: true,
      requiredOrders: [
        {
          galaxusOrderDbId: "db-order-1",
          galaxusOrderId: "GX-1001",
          orderNumber: "1001",
        },
      ],
    });
    expect(createCompositeMock).not.toHaveBeenCalled();
  });

  it("does not block finalize when no delivery note required", async () => {
    findManyMock.mockResolvedValueOnce([
      {
        id: "db-order-2",
        galaxusOrderId: "GX-2002",
        orderNumber: "2002",
        orderDate: new Date("2026-09-02T10:00:00.000Z"),
        physicalDeliveryNoteRequired: false,
        recipientPostalCode: "1000",
        recipientAddress1: "Street 1",
        recipientCity: "Lausanne",
      },
    ]);
    createCompositeMock.mockResolvedValueOnce({
      status: "error",
      message: "mock shipment failure",
      shipments: [],
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/scan-awb/packing-session/finalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entries: [{ galaxusOrderDbId: "db-order-2", galaxusOrderLineId: "line-2" }],
      }),
    });

    const res = await POST(req as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.deliveryNoteRequirement).toEqual({ required: false, requiredOrders: [] });
    expect(createCompositeMock).toHaveBeenCalledTimes(1);
  });
});
