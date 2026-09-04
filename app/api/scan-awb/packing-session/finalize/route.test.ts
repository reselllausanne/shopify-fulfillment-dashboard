import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.fn();
const documentFindFirstMock = vi.fn();
const documentCreateMock = vi.fn();
const shipmentFindUniqueMock = vi.fn();
const createCompositeMock = vi.fn();
const requestSwissPostLabelMock = vi.fn();
const applySwissPostLabelMock = vi.fn();
const generateForShipmentMock = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    galaxusOrder: { findMany: findManyMock },
    document: { findFirst: documentFindFirstMock, create: documentCreateMock },
    shipment: { findUnique: shipmentFindUniqueMock },
  },
}));

vi.mock("@/galaxus/warehouse/shipments", () => ({
  createCompositeWarehouseShipment: createCompositeMock,
}));

vi.mock("@/galaxus/directDelivery/swissPostLabelFlow", () => ({
  applySuccessfulSwissPostLabelToShipment: applySwissPostLabelMock,
  extractLabelPayload: vi.fn(),
  requestSwissPostLabelForOrderWithTrackingHint: requestSwissPostLabelMock,
}));

vi.mock("@/galaxus/directDelivery/runDirectSwissPostLabel", () => ({
  resolveBrowserPrintConfig: vi.fn(() => ({ widthMm: 100, heightMm: 150 })),
}));

vi.mock("@/lib/printEnv", () => ({
  isLocalStation: vi.fn(() => false),
  maybePrintLabelLocally: vi.fn(),
}));

vi.mock("@/galaxus/documents/DocumentService", () => ({
  DocumentService: function MockDocumentService() {
    return { generateForShipment: generateForShipmentMock };
  },
}));

describe("scan packing-session finalize delivery-note behavior", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("does not block finalize when delivery note is required", async () => {
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
        entries: [{ galaxusOrderDbId: "db-order-1", galaxusOrderLineId: "line-1" }],
      }),
    });

    const res = await POST(req as any);
    const data = await res.json();

    expect(res.status).toBe(200);
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
    expect(createCompositeMock).toHaveBeenCalledTimes(1);
  });

  it("returns generated delivery note URL when document missing", async () => {
    findManyMock.mockResolvedValueOnce([
      {
        id: "db-order-3",
        galaxusOrderId: "GX-3003",
        orderNumber: "3003",
        orderDate: new Date("2026-09-03T10:00:00.000Z"),
        physicalDeliveryNoteRequired: true,
        recipientPostalCode: "1000",
        recipientAddress1: "Street 1",
        recipientCity: "Lausanne",
      },
    ]);
    createCompositeMock.mockResolvedValueOnce({
      status: "ok",
      shipments: [{ id: "ship-1" }],
    });
    shipmentFindUniqueMock
      .mockResolvedValueOnce({
        id: "ship-1",
        trackingNumber: null,
        order: { id: "db-order-3", galaxusOrderId: "GX-3003" },
      })
      .mockResolvedValueOnce({
        id: "ship-1",
        orderId: "db-order-3",
        labelPdfUrl: null,
        packageId: null,
      });
    requestSwissPostLabelMock.mockResolvedValueOnce({ ok: true, data: { item: [] } });
    applySwissPostLabelMock.mockResolvedValueOnce({
      trackingNumber: "99.99.99",
      delr: { status: "UPLOADED" },
      url: "/api/galaxus/documents/doc-label-1",
    });
    documentFindFirstMock.mockResolvedValueOnce(null);
    generateForShipmentMock.mockResolvedValueOnce([
      { id: "doc-dn-1", type: "DELIVERY_NOTE" },
    ]);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/scan-awb/packing-session/finalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entries: [{ galaxusOrderDbId: "db-order-3", galaxusOrderLineId: "line-3" }],
      }),
    });

    const res = await POST(req as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.results[0]).toMatchObject({
      ok: true,
      labelUrl: "/api/galaxus/documents/doc-label-1",
      packingSlipUrl: "/api/galaxus/documents/doc-dn-1",
    });
    expect(generateForShipmentMock).toHaveBeenCalledWith({
      shipmentId: "ship-1",
      types: ["DELIVERY_NOTE"],
    });
  });
});
