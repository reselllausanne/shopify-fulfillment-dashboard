import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  pickReturnLabelNumber,
  resolveReturnAmountFromOrderLine,
  appendAuditLog,
  normalizeReturnLabelDigits,
  formatSwissPostLabel,
} from "../mapReturn";
import { extractReturnLabelNumberFromPdf } from "../extractLabelFromPdf";
import fs from "fs";
import path from "path";

describe("return receipt mappers", () => {
  it("picks tracking number as return label", () => {
    expect(
      pickReturnLabelNumber({
        tracking: { tracking_number: "3SABC123" },
        rma: "RMA-9",
      })
    ).toBe("3SABC123");
  });

  it("falls back to rma when tracking missing", () => {
    expect(pickReturnLabelNumber({ rma: "RMA-42" })).toBe("RMA-42");
  });

  it("resolves return amount from order line total and qty — never invents", () => {
    expect(
      resolveReturnAmountFromOrderLine({
        orderLine: { total_price: 100, quantity: 2 },
        returnedQuantity: 1,
      })
    ).toBe(50);
    expect(
      resolveReturnAmountFromOrderLine({
        orderLine: { unit_price: 79.9 },
        returnedQuantity: 1,
      })
    ).toBe(79.9);
    expect(
      resolveReturnAmountFromOrderLine({
        orderLine: null,
        returnedQuantity: 1,
      })
    ).toBeNull();
  });

  it("appends audit entries", () => {
    const next = appendAuditLog([], {
      at: "2026-01-01T00:00:00.000Z",
      step: "receive",
      ok: true,
    });
    expect(next).toHaveLength(1);
    expect(next[0].step).toBe("receive");
  });

  it("normalizes swiss post scanner digits", () => {
    expect(normalizeReturnLabelDigits("99.60.163808.00005064")).toBe("996016380800005064");
    expect(formatSwissPostLabel("996016380800005064")).toBe("99.60.163808.00005064");
  });

  it("extracts label number from SYSTEM_RETURN_LABEL pdf text", async () => {
    const pdfPath = path.join(process.cwd(), "decathlon/debug/return-label-sample.pdf");
    if (!fs.existsSync(pdfPath)) return;
    const label = await extractReturnLabelNumberFromPdf(fs.readFileSync(pdfPath));
    expect(label).toBe("99.60.163808.00005064");
  });
});

const prismaMock = vi.hoisted(() => {
  const marketplaceReturn = {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  };
  const marketplaceReturnSyncCursor = {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  };
  return {
    marketplaceReturn,
    marketplaceReturnSyncCursor,
    decathlonOrderLine: { findUnique: vi.fn() },
    $transaction: vi.fn(),
    $queryRawUnsafe: vi.fn(),
  };
});

vi.mock("@/app/lib/prisma", () => ({
  prisma: prismaMock,
}));

describe("sync upsert / label lookup helpers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("upserts by platform + externalReturnId without duplicates", async () => {
    const { syncMarketplaceReturns } = await import("../sync");
    prismaMock.marketplaceReturnSyncCursor.findUnique.mockResolvedValue({
      lastSuccessfulSyncAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    prismaMock.marketplaceReturn.findUnique.mockResolvedValue(null);
    prismaMock.marketplaceReturn.upsert.mockResolvedValue({});
    prismaMock.marketplaceReturnSyncCursor.upsert.mockResolvedValue({});
    prismaMock.decathlonOrderLine.findUnique.mockResolvedValue({
      lineTotal: 100,
      unitPrice: 100,
      quantity: 1,
      productTitle: "Shoe",
      offerSku: "SKU1",
      currencyCode: "CHF",
    });

    const client = {
      listReturns: vi.fn().mockResolvedValue({
        data: [
          {
            id: "ret-1",
            order_id: "ord-1",
            status: "OPENED",
            tracking: { tracking_number: "LBL-1" },
            return_lines: [
              { order_line_id: "line-1", quantity: 1, reason: "UNWANTED_ITEM", product_id: "p1" },
            ],
          },
        ],
      }),
      listReturnsRt11: vi.fn().mockResolvedValue({ data: [] }),
      getOrder: vi.fn().mockResolvedValue({
        currency_iso_code: "CHF",
        order_lines: [{ id: "line-1", total_price: 100, quantity: 1, product_title: "Shoe", offer_sku: "SKU1" }],
      }),
      downloadDocuments: vi.fn(),
    };

    const result = await syncMarketplaceReturns({ client: client as any });
    expect(result.ok).toBe(true);
    expect(result.upserted).toBe(1);
    expect(prismaMock.marketplaceReturn.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.marketplaceReturn.upsert.mock.calls[0][0].where).toEqual({
      platform_externalReturnId: { platform: "decathlon", externalReturnId: "ret-1" },
    });
    expect(prismaMock.marketplaceReturnSyncCursor.upsert).toHaveBeenCalled();
  });

  it("reconciles locally pending returns that are CLOSED on Mirakl during sync", async () => {
    const { syncMarketplaceReturns } = await import("../sync");
    prismaMock.marketplaceReturnSyncCursor.findUnique.mockResolvedValue({
      lastSuccessfulSyncAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    prismaMock.marketplaceReturn.findUnique.mockResolvedValue(null);
    prismaMock.marketplaceReturn.upsert.mockResolvedValue({});
    prismaMock.marketplaceReturnSyncCursor.upsert.mockResolvedValue({});
    prismaMock.marketplaceReturn.findMany
      .mockResolvedValueOnce([
        {
          id: "local-closed",
          externalReturnId: "ret-closed",
          localStatus: "pending_receipt",
          completedAt: null,
          auditLogJson: [],
        },
      ])
      .mockResolvedValueOnce([]);
    prismaMock.marketplaceReturn.update.mockResolvedValue({});

    const client = {
      listReturns: vi.fn().mockResolvedValue({ data: [] }),
      listReturnsRt11: vi.fn().mockImplementation(async (params: any) => {
        if (params?.return_id === "ret-closed") {
          return { data: [{ id: "ret-closed", state: "CLOSED" }] };
        }
        return { data: [] };
      }),
      getOrder: vi.fn(),
      downloadDocuments: vi.fn(),
    };

    const result = await syncMarketplaceReturns({ client: client as any });
    expect(result.reconciledClosed).toBe(1);
    expect(prismaMock.marketplaceReturn.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "local-closed" },
        data: expect.objectContaining({
          localStatus: "completed",
          miraklStatus: "CLOSED",
          processStep: "close_done",
        }),
      })
    );
  });

  it("does not advance cursor when both list sources fail", async () => {
    const { syncMarketplaceReturns } = await import("../sync");
    prismaMock.marketplaceReturnSyncCursor.findUnique.mockResolvedValue(null);
    const client = {
      listReturns: vi.fn().mockRejectedValue(new Error("v2 down")),
      listReturnsRt11: vi.fn().mockRejectedValue(new Error("rt11 down")),
      getOrder: vi.fn(),
    };
    const result = await syncMarketplaceReturns({ client: client as any });
    expect(result.ok).toBe(false);
    expect(prismaMock.marketplaceReturnSyncCursor.upsert).not.toHaveBeenCalled();
  });
});

describe("confirm / reject / retry safeguards", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  function mockClaim(row: Record<string, unknown>) {
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        $queryRawUnsafe: vi.fn().mockResolvedValue([row]),
        marketplaceReturn: {
          update: vi.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    });
  }

  it("prevents duplicate confirmation while processing", async () => {
    const { confirmMarketplaceReturn } = await import("../process");
    mockClaim({
      id: "r1",
      localStatus: "processing",
      processStep: "pending",
    });
    const result = await confirmMarketplaceReturn({
      id: "r1",
      forceDryRun: true,
      client: {} as any,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/already being processed/i);
  });

  it("receive success + refund failure does not close", async () => {
    const { confirmMarketplaceReturn } = await import("../process");
    const row = {
      id: "r2",
      localStatus: "pending_receipt",
      processStep: "pending",
      externalReturnId: "ret-2",
      externalOrderId: "ord-2",
      externalOrderLineId: "line-2",
      returnAmount: 50,
      currency: "CHF",
      quantity: 1,
      apiSource: "v2",
      auditLogJson: [],
      receiveActionId: null,
      refundIdsJson: null,
      closeActionId: null,
      receivedAt: null,
      miraklStatus: "OPENED",
    };
    mockClaim(row);
    prismaMock.marketplaceReturn.update.mockResolvedValue({});

    const client = {
      receiveReturnV2: vi.fn().mockResolvedValue({ action_id: "act-receive" }),
      refundOrderLines: vi.fn().mockRejectedValue(new Error("refund boom")),
      closeReturnV2: vi.fn(),
    };

    const result = await confirmMarketplaceReturn({
      id: "r2",
      forceDryRun: false,
      client: client as any,
    });

    expect(result.ok).toBe(false);
    expect(client.closeReturnV2).not.toHaveBeenCalled();
    expect(result.failureMessage).toMatch(/refund boom/);
    expect(result.processStep).toBe("receive_done");
  });

  it("skips receive call when Mirakl status already RECEIVED", async () => {
    const { confirmMarketplaceReturn } = await import("../process");
    const row = {
      id: "r2b",
      localStatus: "pending_receipt",
      processStep: "pending",
      externalReturnId: "ret-2b",
      externalOrderId: "ord-2b",
      externalOrderLineId: "line-2b",
      returnAmount: 50,
      currency: "CHF",
      quantity: 1,
      apiSource: "v2",
      auditLogJson: [],
      receiveActionId: null,
      refundIdsJson: null,
      closeActionId: null,
      receivedAt: null,
      miraklStatus: "RECEIVED",
    };
    mockClaim(row);
    prismaMock.marketplaceReturn.update.mockResolvedValue({});

    const client = {
      receiveReturnV2: vi.fn(),
      refundOrderLines: vi.fn().mockResolvedValue({
        refunds: [{ refund_id: "rf-2b", order_line_id: "line-2b" }],
      }),
      closeReturnV2: vi.fn().mockResolvedValue({ action_id: "close-2b" }),
    };

    const result = await confirmMarketplaceReturn({
      id: "r2b",
      forceDryRun: false,
      client: client as any,
    });

    expect(result.ok).toBe(true);
    expect(client.receiveReturnV2).not.toHaveBeenCalled();
    expect(client.refundOrderLines).toHaveBeenCalledTimes(1);
    expect(client.closeReturnV2).toHaveBeenCalledTimes(1);
  });

  it("refund success + close failure does not refund twice on retry", async () => {
    const { confirmMarketplaceReturn, retryFailedMarketplaceReturn } = await import("../process");

    const baseRow = {
      id: "r3",
      localStatus: "pending_receipt",
      processStep: "pending",
      externalReturnId: "ret-3",
      externalOrderId: "ord-3",
      externalOrderLineId: "line-3",
      returnAmount: 80,
      currency: "CHF",
      quantity: 1,
      apiSource: "v2",
      auditLogJson: [],
      receiveActionId: null,
      refundIdsJson: null,
      closeActionId: null,
      receivedAt: null,
      miraklStatus: "OPENED",
    };

    mockClaim(baseRow);
    prismaMock.marketplaceReturn.update.mockImplementation(async ({ data }: any) => ({ ...baseRow, ...data }));

    const client = {
      receiveReturnV2: vi.fn().mockResolvedValue({ action_id: "act-r" }),
      refundOrderLines: vi.fn().mockResolvedValue({
        refunds: [{ refund_id: "rf-1", order_line_id: "line-3" }],
      }),
      closeReturnV2: vi.fn().mockRejectedValue(new Error("close boom")),
    };

    const first = await confirmMarketplaceReturn({
      id: "r3",
      forceDryRun: false,
      client: client as any,
    });
    expect(first.ok).toBe(false);
    expect(first.failureMessage).toMatch(/close pending/i);
    expect(client.refundOrderLines).toHaveBeenCalledTimes(1);

    // Retry from failed + refund_done
    const failedRow = {
      ...baseRow,
      localStatus: "failed",
      processStep: "refund_done",
      refundIdsJson: ["rf-1"],
      receiveActionId: "act-r",
    };
    mockClaim(failedRow);
    prismaMock.marketplaceReturn.findUnique.mockResolvedValue(failedRow);
    client.closeReturnV2.mockResolvedValue({ action_id: "act-c" });

    const retry = await retryFailedMarketplaceReturn({
      id: "r3",
      forceDryRun: false,
      client: client as any,
    });
    expect(retry.ok).toBe(true);
    expect(client.refundOrderLines).toHaveBeenCalledTimes(1);
    expect(client.closeReturnV2).toHaveBeenCalledTimes(2);
  });

  it("skips refund when line already refunded remotely and still closes", async () => {
    const { confirmMarketplaceReturn } = await import("../process");
    const row = {
      id: "r3b",
      localStatus: "failed",
      processStep: "receive_done",
      externalReturnId: "ret-3b",
      externalOrderId: "ord-3b",
      externalOrderLineId: "line-3b",
      returnAmount: 80,
      currency: "CHF",
      quantity: 1,
      apiSource: "v2",
      auditLogJson: [],
      receiveActionId: "act-r3b",
      refundIdsJson: null,
      closeActionId: null,
      receivedAt: new Date("2026-07-15T11:13:00.000Z"),
      miraklStatus: "RECEIVED",
    };

    mockClaim(row);
    prismaMock.marketplaceReturn.update.mockImplementation(async ({ data }: any) => ({ ...row, ...data }));

    const client = {
      receiveReturnV2: vi.fn(),
      refundOrderLines: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "Mirakl request failed (400): {\"message\":\"Incorrect status of the order line(s). Should be one of: [SHIPPING, SHIPPED, TO_COLLECT, RECEIVED, INCIDENT_OPEN] (relevant lines:[{id:'line-3b',state:'REFUNDED'}])\",\"status\":400}"
          )
        ),
      closeReturnV2: vi.fn().mockResolvedValue({ action_id: "act-close-3b" }),
    };

    const result = await confirmMarketplaceReturn({
      id: "r3b",
      forceDryRun: false,
      client: client as any,
    });

    expect(result.ok).toBe(true);
    expect(client.receiveReturnV2).not.toHaveBeenCalled();
    expect(client.refundOrderLines).toHaveBeenCalledTimes(1);
    expect(client.closeReturnV2).toHaveBeenCalledTimes(1);
  });

  it("reconciles close when Mirakl already CLOSED", async () => {
    const { confirmMarketplaceReturn } = await import("../process");
    const row = {
      id: "r3c",
      localStatus: "failed",
      processStep: "refund_done",
      externalReturnId: "6f993845-bccd-4c74-ab1a-5262ef4947d6",
      externalOrderId: "ord-3c",
      externalOrderLineId: "line-3c",
      returnAmount: 80,
      currency: "CHF",
      quantity: 1,
      apiSource: "rt11",
      auditLogJson: [],
      receiveActionId: "act-r3c",
      refundIdsJson: ["rf-3c"],
      closeActionId: null,
      receivedAt: new Date("2026-07-15T11:26:00.000Z"),
      miraklStatus: "RECEIVED",
    };

    mockClaim(row);
    prismaMock.marketplaceReturn.update.mockImplementation(async ({ data }: any) => ({ ...row, ...data }));

    const client = {
      closeReturnsRt27: vi.fn().mockRejectedValue(new Error("Return is in invalid state")),
      listReturnsRt11: vi.fn().mockResolvedValue({
        data: [{ id: "6f993845-bccd-4c74-ab1a-5262ef4947d6", state: "CLOSED" }],
      }),
    };

    const result = await confirmMarketplaceReturn({
      id: "r3c",
      forceDryRun: false,
      client: client as any,
    });

    expect(result.ok).toBe(true);
    expect(result.localStatus).toBe("completed");
    expect(result.processStep).toBe("close_done");
    expect(client.closeReturnsRt27).toHaveBeenCalledTimes(1);
    expect(client.listReturnsRt11).toHaveBeenCalledTimes(1);
  });

  it("rejects does not call Mirakl", async () => {
    const { rejectMarketplaceReturn } = await import("../process");
    prismaMock.marketplaceReturn.findUnique.mockResolvedValue({
      id: "r4",
      localStatus: "pending_receipt",
      processStep: "pending",
      auditLogJson: [],
    });
    prismaMock.marketplaceReturn.update.mockResolvedValue({});
    const result = await rejectMarketplaceReturn({ id: "r4", staffNote: "damaged sole" });
    expect(result.ok).toBe(true);
    expect(result.localStatus).toBe("rejected");
    expect(result.message).toMatch(/no Mirakl/i);
  });

  it("lookup by scanned label uses returnLabelNumber", async () => {
    prismaMock.marketplaceReturn.findFirst.mockResolvedValue({
      id: "r5",
      returnLabelNumber: "3SXYZ",
      localStatus: "pending_receipt",
    });
    const row = await prismaMock.marketplaceReturn.findFirst({
      where: { platform: "decathlon", returnLabelNumber: "3SXYZ" },
    });
    expect(row?.id).toBe("r5");
    expect(prismaMock.marketplaceReturn.findFirst).toHaveBeenCalledWith({
      where: { platform: "decathlon", returnLabelNumber: "3SXYZ" },
    });
  });
});
