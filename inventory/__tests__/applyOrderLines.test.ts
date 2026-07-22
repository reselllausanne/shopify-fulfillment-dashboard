import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

vi.mock("@/inventory/resolveSupplierVariant", () => ({
  resolveSupplierVariantForInventoryLine: vi.fn(),
}));

vi.mock("@/inventory/theSaleChannelSync", () => ({
  scheduleTheSaleChannelSync: vi.fn(),
}));

vi.mock("@/shopify/inventory/marketplacePhysicalSale", () => ({
  routeMarketplacePhysicalSale: vi.fn().mockResolvedValue({ routed: false, decremented: 0, locations: [], warnings: [] }),
}));

vi.mock("@/galaxus/warehouse/theCatalogStock", async () => {
  const actual = await vi.importActual<typeof import("@/galaxus/warehouse/theCatalogStock")>(
    "@/galaxus/warehouse/theCatalogStock"
  );
  return {
    ...actual,
    applyTheCatalogStockDeltaInTx: vi.fn().mockResolvedValue(true),
  };
});

import { prisma } from "@/app/lib/prisma";
import { resolveSupplierVariantForInventoryLine } from "@/inventory/resolveSupplierVariant";
import { applyInventoryOrderLine } from "@/inventory/applyOrderLines";
import { scheduleTheSaleChannelSync } from "@/inventory/theSaleChannelSync";
import { routeMarketplacePhysicalSale } from "@/shopify/inventory/marketplacePhysicalSale";
import { applyTheCatalogStockDeltaInTx } from "@/galaxus/warehouse/theCatalogStock";

const mockedPrisma = prisma as unknown as {
  $transaction: ReturnType<typeof vi.fn>;
};

const mockedResolver = resolveSupplierVariantForInventoryLine as unknown as ReturnType<typeof vi.fn>;

describe("applyInventoryOrderLine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unresolved when supplier variant cannot be resolved", async () => {
    mockedResolver.mockResolvedValue(null);

    const result = await applyInventoryOrderLine({
      channel: "SHOPIFY",
      externalOrderId: "gid://shopify/Order/1",
      externalLineId: "gid://shopify/LineItem/1",
      quantity: 1,
      sku: "STX_123",
    });

    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toBe("unresolved_variant");
    }
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns already_processed when line already synced", async () => {
    mockedResolver.mockResolvedValue({
      supplierVariantId: "stx_1",
      providerKey: "STX_123",
      gtin: "123",
    });

    const tx = {
      orderLineSyncState: {
        findUnique: vi.fn().mockResolvedValue({ id: "sync-1", eventId: "evt-1" }),
        update: vi.fn().mockResolvedValue({ id: "sync-1" }),
        create: vi.fn(),
      },
      inventoryEvent: {
        create: vi.fn(),
      },
      channelListingState: {
        upsert: vi.fn(),
      },
    };

    mockedPrisma.$transaction.mockImplementation(async (handler: any) => handler(tx));

    const result = await applyInventoryOrderLine({
      channel: "DECATHLON",
      externalOrderId: "ORDER-1",
      externalLineId: "LINE-1",
      quantity: 2,
      providerKey: "NER_1234567890123",
    });

    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toBe("already_processed");
    }
    expect(tx.inventoryEvent.create).not.toHaveBeenCalled();
  });

  it("creates negative delta for sale and positive delta for return", async () => {
    mockedResolver.mockResolvedValue({
      supplierVariantId: "stx_2",
      providerKey: "STX_456",
      gtin: "456",
    });

    const tx = {
      orderLineSyncState: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        update: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: "sync-2" }),
      },
      inventoryEvent: {
        create: vi
          .fn()
          .mockResolvedValueOnce({ id: "evt-sale" })
          .mockResolvedValueOnce({ id: "evt-return" }),
      },
      channelListingState: {
        upsert: vi.fn().mockResolvedValue({ id: "listing-1" }),
      },
    };

    mockedPrisma.$transaction.mockImplementation(async (handler: any) => handler(tx));

    await applyInventoryOrderLine({
      channel: "GALAXUS",
      externalOrderId: "G-1",
      externalLineId: "G-LINE-1",
      quantity: 2,
      providerKey: "STX_456",
      eventType: "SALE",
    });

    await applyInventoryOrderLine({
      channel: "GALAXUS",
      externalOrderId: "G-1",
      externalLineId: "G-LINE-2",
      quantity: 3,
      providerKey: "STX_456",
      eventType: "RETURN",
    });

    const firstCall = tx.inventoryEvent.create.mock.calls[0][0].data;
    const secondCall = tx.inventoryEvent.create.mock.calls[1][0].data;

    expect(firstCall.quantityDelta).toBe(-2);
    expect(secondCall.quantityDelta).toBe(3);
  });

  it("decrements THE catalog stock and schedules channel sync on sale", async () => {
    mockedResolver.mockResolvedValue({
      supplierVariantId: "the:IM4002-100-40",
      providerKey: "THE_198726522040",
      gtin: "198726522040",
    });

    const tx = {
      orderLineSyncState: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: "sync-the" }),
      },
      inventoryEvent: {
        create: vi.fn().mockResolvedValue({ id: "evt-the" }),
      },
      channelListingState: {
        upsert: vi.fn().mockResolvedValue({ id: "listing-the" }),
      },
    };

    mockedPrisma.$transaction.mockImplementation(async (handler: any) => handler(tx));

    const result = await applyInventoryOrderLine({
      channel: "GALAXUS",
      externalOrderId: "195400913",
      externalLineId: "GALAXUS:195400913:5",
      quantity: 1,
      providerKey: "THE_198726522040",
      eventType: "SALE",
    });

    expect(result.applied).toBe(true);
    expect(applyTheCatalogStockDeltaInTx).toHaveBeenCalledWith(
      tx,
      "the:IM4002-100-40",
      -1,
      "GALAXUS:GALAXUS:195400913:5"
    );
    expect(scheduleTheSaleChannelSync).toHaveBeenCalledWith({
      providerKeys: ["THE_198726522040"],
    });
  });

  it("routes marketplace physical sale after Galaxus sale apply", async () => {
    mockedResolver.mockResolvedValue({
      supplierVariantId: "stx_2",
      providerKey: "STX_456",
      gtin: "456",
    });

    const tx = {
      orderLineSyncState: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: "sync-gal" }),
      },
      inventoryEvent: {
        create: vi.fn().mockResolvedValue({ id: "evt-gal" }),
      },
      channelListingState: {
        upsert: vi.fn().mockResolvedValue({ id: "listing-gal" }),
      },
    };

    mockedPrisma.$transaction.mockImplementation(async (handler: any) => handler(tx));

    await applyInventoryOrderLine({
      channel: "GALAXUS",
      externalOrderId: "G-1",
      externalLineId: "G-LINE-1",
      quantity: 1,
      providerKey: "STX_456",
      gtin: "456",
      eventType: "SALE",
    });

    expect(routeMarketplacePhysicalSale).toHaveBeenCalledWith({
      channel: "GALAXUS",
      externalLineId: "G-LINE-1",
      externalOrderId: "G-1",
      gtin: "456",
      quantity: 1,
    });
  });
});
