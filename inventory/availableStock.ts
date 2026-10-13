import { prisma } from "@/app/lib/prisma";
import {
  applySupplierStockPublishGate,
  defaultPolicyStatusForSupplier,
  isSupplierStockPublishEnforced,
  loadEvidencePublishedQtyMap,
  loadPolicyStatusMap,
  resolveSupplierKeyFromIds,
  SCRAPER_SUPPLIER_KEYS,
  type SupplierStockPolicyStatus,
} from "@/inventory/supplierStock";

type SupplierVariantLike = {
  supplierVariantId?: string | null;
  stock?: number | string | null;
  manualLock?: boolean | null;
  manualStock?: number | string | null;
  providerKey?: string | null;
};

function toInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveBaseStock(variant: SupplierVariantLike): number {
  const manualLock = Boolean(variant?.manualLock);
  const manualStock = toInt(variant?.manualStock);
  const stock = toInt(variant?.stock) ?? 0;
  if (manualLock && manualStock !== null) return Math.max(0, manualStock);
  return Math.max(0, stock);
}

export function resolveInventoryAvailableStock(variant: SupplierVariantLike, delta = 0): number {
  const base = resolveBaseStock(variant);
  // THE warehouse stock is decremented on SALE in SupplierVariant.stock — do not re-apply ledger.
  const id = String(variant?.supplierVariantId ?? "")
    .trim()
    .toLowerCase();
  if (id.startsWith("the_") || id.startsWith("the:")) {
    return base;
  }
  const sum = base + (Number.isFinite(delta) ? Math.trunc(delta) : 0);
  return Math.max(0, sum);
}

/** Postgres prepared-statement bind limit is 32767 — chunk large IN lists. */
const INVENTORY_DELTA_CHUNK_SIZE = 5000;

/**
 * Scraped stock older than this is dead stock → 0 on every channel.
 * Crons run daily, so 2 days tolerates one missed run.
 * SUPPLIER_STOCK_MAX_AGE_DAYS=0 disables.
 */
export function supplierStockMaxAgeDays(): number {
  const raw = String(process.env.SUPPLIER_STOCK_MAX_AGE_DAYS ?? "").trim();
  if (raw === "") return 2;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : 2;
}

/**
 * REI is scraped weekly, so its stock stays valid one full cycle plus a missed-run day.
 * SUPPLIER_STOCK_MAX_AGE_DAYS_REI overrides.
 */
export function supplierStockMaxAgeDaysFor(supplierKey: string | null | undefined): number {
  const key = String(supplierKey ?? "").trim().toLowerCase();
  if (key !== "rei") return supplierStockMaxAgeDays();
  const n = Number.parseFloat(String(process.env.SUPPLIER_STOCK_MAX_AGE_DAYS_REI ?? "").trim());
  return Number.isFinite(n) && n >= 0 ? n : 8;
}

export function isScrapedStockStale(
  lastSyncAt: Date | null | undefined,
  now: Date = new Date(),
  maxAgeDays: number = supplierStockMaxAgeDays()
): boolean {
  if (maxAgeDays <= 0) return false;
  if (!lastSyncAt) return true;
  const ts = lastSyncAt instanceof Date ? lastSyncAt.getTime() : new Date(lastSyncAt).getTime();
  if (!Number.isFinite(ts)) return true;
  return now.getTime() - ts > maxAgeDays * 86_400_000;
}

function isScrapedSupplierVariantId(supplierVariantId: string): boolean {
  const key = resolveSupplierKeyFromIds(supplierVariantId);
  return Boolean(key && SCRAPER_SUPPLIER_KEYS.has(key));
}

/** Own stock: SupplierVariant.stock is never re-reported by a supplier, so the full ledger applies. */
const OWN_STOCK_SUPPLIER_KEYS = new Set(["the", "golden", "gld"]);

/**
 * Feed suppliers (STX asks, NER / partner imports) re-report stock that already
 * includes our sales, but only bump lastSyncAt when a value changes. A sale
 * therefore only counts while the supplier may not have caught up yet.
 * SUPPLIER_LEDGER_WINDOW_HOURS=0 restores the full ledger.
 */
export function supplierLedgerWindowHours(): number {
  const raw = String(process.env.SUPPLIER_LEDGER_WINDOW_HOURS ?? "").trim();
  if (raw === "") return 48;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : 48;
}

function isWindowedLedgerSupplierVariantId(supplierVariantId: string): boolean {
  const key = String(supplierVariantId ?? "").trim().toLowerCase().split(/[_:]/)[0] ?? "";
  if (!key || OWN_STOCK_SUPPLIER_KEYS.has(key)) return false;
  return !SCRAPER_SUPPLIER_KEYS.has(key);
}

export async function loadLastSyncAtBySupplierVariantId(
  supplierVariantIds: string[]
): Promise<Map<string, Date | null>> {
  const ids = Array.from(new Set(supplierVariantIds.map((id) => String(id ?? "").trim()).filter(Boolean)));
  const map = new Map<string, Date | null>();
  const prismaAny = prisma as any;
  if (ids.length === 0 || !prismaAny.supplierVariant?.findMany) return map;
  for (let offset = 0; offset < ids.length; offset += INVENTORY_DELTA_CHUNK_SIZE) {
    const chunk = ids.slice(offset, offset + INVENTORY_DELTA_CHUNK_SIZE);
    const rows = await prismaAny.supplierVariant.findMany({
      where: { supplierVariantId: { in: chunk } },
      select: { supplierVariantId: true, lastSyncAt: true },
    });
    for (const row of rows ?? []) {
      map.set(String(row.supplierVariantId), row.lastSyncAt ? new Date(row.lastSyncAt) : null);
    }
  }
  return map;
}

export async function loadInventoryDeltasBySupplierVariantId(
  supplierVariantIds: string[]
): Promise<Map<string, number>> {
  const ids = Array.from(new Set(supplierVariantIds.map((id) => String(id ?? "").trim()).filter(Boolean)));
  const map = new Map<string, number>();
  if (ids.length === 0) return map;

  const prismaAny = prisma as any;
  if (!prismaAny.inventoryEvent?.groupBy) {
    return map;
  }

  try {
    for (let offset = 0; offset < ids.length; offset += INVENTORY_DELTA_CHUNK_SIZE) {
      const chunk = ids.slice(offset, offset + INVENTORY_DELTA_CHUNK_SIZE);
      const rows = await prismaAny.inventoryEvent.groupBy({
        by: ["supplierVariantId"],
        where: { supplierVariantId: { in: chunk } },
        _sum: { quantityDelta: true },
      });
      for (const row of rows ?? []) {
        const id = String(row?.supplierVariantId ?? "").trim();
        if (!id) continue;
        const delta = Number(row?._sum?.quantityDelta ?? 0);
        map.set(id, Number.isFinite(delta) ? Math.trunc(delta) : 0);
      }
    }
    return map;
  } catch (error: any) {
    const message = String(error?.message ?? "");
    if (
      message.includes("inventoryEvent") ||
      message.includes("relation") ||
      message.includes("does not exist") ||
      message.includes("too many bind variables")
    ) {
      console.warn("[inventory][availableStock] delta load failed — using base stock only", message.slice(0, 200));
      return map;
    }
    throw error;
  }
}

/**
 * A scrape observes the supplier's real stock, so sales booked before it are
 * already reflected. Only ledger events after the last scrape still apply —
 * otherwise a scraped item that sold once stays at 0 forever.
 */
export async function loadDeltasSinceLastSync(
  lastSyncById: Map<string, Date | null>
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const prismaAny = prisma as any;
  const ids = [...lastSyncById.entries()].filter(([, at]) => at instanceof Date).map(([id]) => id);
  if (ids.length === 0 || !prismaAny.inventoryEvent?.findMany) return map;
  for (let offset = 0; offset < ids.length; offset += INVENTORY_DELTA_CHUNK_SIZE) {
    const chunk = ids.slice(offset, offset + INVENTORY_DELTA_CHUNK_SIZE);
    const rows = await prismaAny.inventoryEvent.findMany({
      where: { supplierVariantId: { in: chunk } },
      select: { supplierVariantId: true, quantityDelta: true, createdAt: true },
    });
    for (const id of chunk) map.set(id, 0);
    for (const row of rows ?? []) {
      const id = String(row?.supplierVariantId ?? "").trim();
      const since = lastSyncById.get(id);
      if (!since || !row?.createdAt || new Date(row.createdAt).getTime() <= since.getTime()) continue;
      const delta = Number(row?.quantityDelta ?? 0);
      if (Number.isFinite(delta)) map.set(id, (map.get(id) ?? 0) + Math.trunc(delta));
    }
  }
  return map;
}

export async function attachAvailableStock<T extends SupplierVariantLike>(
  variants: T[]
): Promise<Map<string, number>> {
  const ids = variants
    .map((variant) => String(variant?.supplierVariantId ?? "").trim())
    .filter(Boolean);
  const deltas = await loadInventoryDeltasBySupplierVariantId(ids);
  const stockBySupplierVariantId = new Map<string, number>();

  const maxAgeDays = supplierStockMaxAgeDays();
  const now = new Date();
  const lastSyncById = await loadLastSyncAtBySupplierVariantId(
    variants
      .filter((variant) => !variant?.manualLock)
      .map((variant) => String(variant?.supplierVariantId ?? "").trim())
      .filter(isScrapedSupplierVariantId)
      .filter((id) => (deltas.get(id) ?? 0) !== 0 || maxAgeDays > 0)
  );
  const scrapedWithLedger = new Map(
    [...lastSyncById.entries()].filter(([id]) => (deltas.get(id) ?? 0) !== 0)
  );
  for (const [id, delta] of await loadDeltasSinceLastSync(scrapedWithLedger)) {
    deltas.set(id, delta);
  }
  const ledgerWindowHours = supplierLedgerWindowHours();
  if (ledgerWindowHours > 0) {
    const windowStart = new Date(now.getTime() - ledgerWindowHours * 3_600_000);
    const windowed = new Map<string, Date | null>(
      [...deltas.entries()]
        .filter(([id, delta]) => delta !== 0 && isWindowedLedgerSupplierVariantId(id))
        .map(([id]) => [id, windowStart])
    );
    for (const [id, delta] of await loadDeltasSinceLastSync(windowed)) {
      deltas.set(id, delta);
    }
  }
  let staleZeroed = 0;

  const publishEnforced = isSupplierStockPublishEnforced();
  let policyMap = new Map<string, SupplierStockPolicyStatus>();
  let evidenceMap = new Map<string, { publishedQty: number; lastProofAt: Date | null }>();
  if (publishEnforced) {
    try {
      if (typeof loadPolicyStatusMap === "function") {
        policyMap = await loadPolicyStatusMap();
      }
      if (typeof loadEvidencePublishedQtyMap === "function") {
        evidenceMap = await loadEvidencePublishedQtyMap(ids);
      }
    } catch (err: any) {
      console.warn(
        "[inventory][availableStock] supplier-stock gate skipped",
        String(err?.message ?? err).slice(0, 200)
      );
    }
  }

  for (const variant of variants) {
    const supplierVariantId = String(variant?.supplierVariantId ?? "").trim();
    if (!supplierVariantId) continue;
    const delta = deltas.get(supplierVariantId) ?? 0;
    let stock = resolveInventoryAvailableStock(variant, delta);

    // OBSERVATION_ONLY_NOT_ENFORCED: never alter marketplace qty until flag=1.
    if (publishEnforced && !variant?.manualLock) {
      const supplierKey = resolveSupplierKeyFromIds(supplierVariantId);
      if (supplierKey && SCRAPER_SUPPLIER_KEYS.has(supplierKey)) {
        const policyStatus =
          (policyMap.get(supplierKey) as SupplierStockPolicyStatus | undefined) ??
          defaultPolicyStatusForSupplier(supplierKey);
        const evidence = evidenceMap.get(supplierVariantId);
        stock = applySupplierStockPublishGate({
          baseStock: stock,
          policyStatus,
          evidencePublishedQty: evidence?.publishedQty ?? null,
          lastProofAt: evidence?.lastProofAt ?? null,
          manualLock: false,
          enforced: true,
        });
      }
    }

    if (
      stock > 0 &&
      lastSyncById.has(supplierVariantId) &&
      isScrapedStockStale(
        lastSyncById.get(supplierVariantId),
        now,
        supplierStockMaxAgeDaysFor(resolveSupplierKeyFromIds(supplierVariantId))
      )
    ) {
      stock = 0;
      staleZeroed += 1;
    }

    stockBySupplierVariantId.set(supplierVariantId, stock);
  }

  if (staleZeroed > 0) {
    console.info("[inventory][availableStock] stale scraped stock zeroed", { staleZeroed, maxAgeDays });
  }

  return stockBySupplierVariantId;
}
