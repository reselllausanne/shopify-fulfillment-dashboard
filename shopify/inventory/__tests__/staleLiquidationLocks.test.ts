import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    supplierVariant: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

import { prisma } from "@/app/lib/prisma";
import {
  buildLiquidationReleaseData,
  isPhysicalLiquidationLockNote,
  releasePhysicalLiquidationLocksBeforeDetach,
  releaseStaleLiquidationLocks,
  STALE_LIQUIDATION_RELEASE_NOTE,
} from "@/shopify/inventory/staleLiquidationLocks";

const queryRaw = prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>;
const findFirst = prisma.supplierVariant.findFirst as unknown as ReturnType<typeof vi.fn>;
const findMany = prisma.supplierVariant.findMany as unknown as ReturnType<typeof vi.fn>;
const update = prisma.supplierVariant.update as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-10-11T12:00:00Z");
const FRESH = new Date("2026-10-11T06:00:00Z");
const FROZEN = new Date("2026-07-31T10:09:45Z");

function lockedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sv-1",
    supplierVariantId: "stx_a4a0476c",
    supplierProductName: "Onitsuka Tiger Mexico 66 Birch Peacoat",
    sizeRaw: "EU 38",
    manualNote: "restock:liquidation compareAt=249.00",
    manualPrice: "119.00",
    lastSyncAt: FROZEN,
    svGtin: null,
    svProviderKey: null,
    mappingGtin: "6941936347170",
    mappingProviderKey: "STX_6941936347170",
    physicalQty: 0,
    ...overrides,
  };
}

describe("isPhysicalLiquidationLockNote", () => {
  it("matches scan/backfill and convergence liquidation notes", () => {
    expect(isPhysicalLiquidationLockNote("restock:liquidation compareAt=249.00")).toBe(true);
    expect(isPhysicalLiquidationLockNote("phase4:liquidation physical=1 @ Warehouse Bussigny")).toBe(true);
  });

  it("never matches operator / fixed-retail locks", () => {
    expect(isPhysicalLiquidationLockNote("mq2-liquidation")).toBe(false);
    expect(isPhysicalLiquidationLockNote("galaxus-liquidation 99")).toBe(false);
    expect(isPhysicalLiquidationLockNote("jmoney-kicks:price-lock")).toBe(false);
    expect(isPhysicalLiquidationLockNote("in-stock:fixed-price Essentials")).toBe(false);
    expect(isPhysicalLiquidationLockNote(null)).toBe(false);
  });
});

describe("buildLiquidationReleaseData", () => {
  it("zeroes stock when STX data is frozen past the sync window", () => {
    const data = buildLiquidationReleaseData({ lastSyncAt: FROZEN, note: "x", now: NOW });
    expect(data).toMatchObject({ manualLock: false, manualPrice: null, manualStock: null, stock: 0 });
  });

  it("keeps live stock when STX data is fresh", () => {
    const data = buildLiquidationReleaseData({ lastSyncAt: FRESH, note: "x", now: NOW });
    expect(data).not.toHaveProperty("stock");
    expect(data.manualLock).toBe(false);
  });
});

describe("releaseStaleLiquidationLocks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirst.mockResolvedValue(null);
  });

  it("does nothing when the physical mirror is empty", async () => {
    queryRaw.mockResolvedValueOnce([{ n: BigInt(0) }]);
    const res = await releaseStaleLiquidationLocks();
    expect(res.skippedReason).toBe("physical_mirror_empty");
    expect(update).not.toHaveBeenCalled();
  });

  it("releases a lock with no physical pair and restores the detached GTIN from the mapping", async () => {
    queryRaw.mockResolvedValueOnce([{ n: BigInt(300) }]).mockResolvedValueOnce([lockedRow()]);
    const res = await releaseStaleLiquidationLocks();
    expect(res.released).toHaveLength(1);
    expect(res.released[0]).toMatchObject({ gtin: "6941936347170", restoredGtin: true, zeroedStaleStock: true });
    expect(update).toHaveBeenCalledWith({
      where: { id: "sv-1" },
      data: expect.objectContaining({
        manualLock: false,
        manualPrice: null,
        stock: 0,
        manualNote: STALE_LIQUIDATION_RELEASE_NOTE,
        gtin: "6941936347170",
        providerKey: "STX_6941936347170",
      }),
    });
  });

  it("keeps locks whose pair is still on a liquidation shelf", async () => {
    queryRaw
      .mockResolvedValueOnce([{ n: BigInt(300) }])
      .mockResolvedValueOnce([lockedRow({ physicalQty: 2, svGtin: "4570158749077" })]);
    const res = await releaseStaleLiquidationLocks();
    expect(res.kept).toBe(1);
    expect(res.released).toHaveLength(0);
    expect(update).not.toHaveBeenCalled();
  });

  it("does not restore a GTIN another row already holds", async () => {
    queryRaw.mockResolvedValueOnce([{ n: BigInt(300) }]).mockResolvedValueOnce([lockedRow()]);
    findFirst.mockResolvedValueOnce({ id: "sv-other" });
    const res = await releaseStaleLiquidationLocks();
    expect(res.released[0].restoredGtin).toBe(false);
    const data = update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("gtin");
    expect(data.manualLock).toBe(false);
  });

  it("dry-run reports without writing", async () => {
    queryRaw.mockResolvedValueOnce([{ n: BigInt(300) }]).mockResolvedValueOnce([lockedRow()]);
    const res = await releaseStaleLiquidationLocks({ dryRun: true });
    expect(res.released).toHaveLength(1);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("releasePhysicalLiquidationLocksBeforeDetach", () => {
  beforeEach(() => vi.clearAllMocks());

  it("releases only physical liquidation locks on rows about to lose their GTIN", async () => {
    findMany.mockResolvedValueOnce([
      { id: "a", manualNote: "restock:liquidation compareAt=249.00", lastSyncAt: FRESH },
      { id: "b", manualNote: "jmoney-kicks:price-lock", lastSyncAt: FRESH },
    ]);
    const released = await releasePhysicalLiquidationLocksBeforeDetach({ gtin: "123" });
    expect(released).toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].where).toEqual({ id: "a" });
  });
});
